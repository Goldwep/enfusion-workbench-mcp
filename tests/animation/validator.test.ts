import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateGraph } from "../../src/animation/validator.js";
import type { ParsedAgf, ParsedAgr, ParsedAsi } from "../../src/animation/types.js";

function makeAgf(nodes: Array<Record<string, unknown>>): ParsedAgf {
  return {
    sheets: [
      {
        name: "Main",
        nodes: nodes.map((n) => ({
          type: n.type as string,
          name: n.name as string,
          children: (n.children ?? []) as string[],
          properties: (n.properties ?? {}) as Record<string, unknown>,
          editorPos: { x: 0, y: 0 },
          raw: "",
        })),
      },
    ],
  };
}

/** Build a minimal AGR struct, with the bits the V14–V18 tests want to override. */
function makeAgr(opts?: Partial<ParsedAgr>): ParsedAgr {
  return {
    variables: [],
    commands: [],
    ikChains: [],
    boneMasks: [],
    globalTags: [],
    defaultRunNode: null,
    agfReferences: [],
    astReference: null,
    ...opts,
  };
}

describe("V01: Integer Duration", () => {
  it("flags transition with integer duration", () => {
    const agf = makeAgf([
      {
        type: "AnimSrcNodeStateMachine",
        name: "SM",
        children: [],
        properties: {
          states: [
            { name: "A", startCondition: "1", timeMode: "Normtime", exit: false, child: null },
          ],
          transitions: [
            {
              from: "A",
              to: "B",
              condition: "x",
              duration: "0",
              postEval: false,
              blendFn: null,
              startTime: null,
            },
          ],
        },
      },
    ]);
    const result = validateGraph(agf);
    expect(result.issues.some((i) => i.id === "V01")).toBe(true);
    expect(result.errorCount).toBeGreaterThanOrEqual(1);
  });

  it("passes with decimal duration", () => {
    const agf = makeAgf([
      {
        type: "AnimSrcNodeStateMachine",
        name: "SM",
        children: [],
        properties: {
          states: [],
          transitions: [
            {
              from: "A",
              to: "B",
              condition: "x",
              duration: "0.3",
              postEval: false,
              blendFn: null,
              startTime: null,
            },
          ],
        },
      },
    ]);
    const result = validateGraph(agf);
    expect(result.issues.some((i) => i.id === "V01")).toBe(false);
  });
});

describe("V02: Missing PostEval", () => {
  it("flags condition using RemainingTimeLess without PostEval", () => {
    const agf = makeAgf([
      {
        type: "AnimSrcNodeStateMachine",
        name: "SM",
        children: [],
        properties: {
          states: [],
          transitions: [
            {
              from: "A",
              to: "B",
              condition: "RemainingTimeLess(0.2)",
              duration: "0.3",
              postEval: false,
              blendFn: null,
              startTime: null,
            },
          ],
        },
      },
    ]);
    const result = validateGraph(agf);
    expect(result.issues.some((i) => i.id === "V02")).toBe(true);
  });

  it("passes when PostEval is enabled", () => {
    const agf = makeAgf([
      {
        type: "AnimSrcNodeStateMachine",
        name: "SM",
        children: [],
        properties: {
          states: [],
          transitions: [
            {
              from: "A",
              to: "B",
              condition: "RemainingTimeLess(0.2)",
              duration: "0.3",
              postEval: true,
              blendFn: null,
              startTime: null,
            },
          ],
        },
      },
    ]);
    const result = validateGraph(agf);
    expect(result.issues.some((i) => i.id === "V02")).toBe(false);
  });
});

describe("V03: No catch-all state", () => {
  it("flags StateMachine without StartCondition '1' as last state", () => {
    const agf = makeAgf([
      {
        type: "AnimSrcNodeStateMachine",
        name: "SM",
        children: [],
        properties: {
          states: [
            {
              name: "A",
              startCondition: "Speed == 0",
              timeMode: "Normtime",
              exit: false,
              child: null,
            },
            {
              name: "B",
              startCondition: "Speed > 0",
              timeMode: "Normtime",
              exit: false,
              child: null,
            },
          ],
          transitions: [],
        },
      },
    ]);
    const result = validateGraph(agf);
    expect(result.issues.some((i) => i.id === "V03")).toBe(true);
  });
});

describe("V04: Duplicate node names", () => {
  it("flags duplicate names within a sheet", () => {
    const agf = makeAgf([
      { type: "AnimSrcNodeBindPose", name: "Dupe", children: [] },
      { type: "AnimSrcNodeSource", name: "Dupe", children: [] },
    ]);
    const result = validateGraph(agf);
    expect(result.issues.some((i) => i.id === "V04")).toBe(true);
  });
});

describe("V05: Orphan nodes", () => {
  it("flags nodes not referenced by any parent", () => {
    const agf = makeAgf([
      { type: "AnimSrcNodeQueue", name: "Root", children: ["Child1"] },
      { type: "AnimSrcNodeBindPose", name: "Child1", children: [] },
      { type: "AnimSrcNodeBindPose", name: "Orphan", children: [] },
    ]);
    const result = validateGraph(agf);
    expect(result.issues.some((i) => i.id === "V05" && i.message.includes("Orphan"))).toBe(true);
  });
});

describe("V06: DefaultRunNode mismatch", () => {
  it("flags when DefaultRunNode doesn't match any Queue", () => {
    const agf = makeAgf([{ type: "AnimSrcNodeQueue", name: "Root", children: [] }]);
    const agr: ParsedAgr = {
      variables: [],
      commands: [],
      ikChains: [],
      boneMasks: [],
      globalTags: [],
      defaultRunNode: "NonExistent",
      agfReferences: [],
      astReference: null,
    };
    const result = validateGraph(agf, agr);
    expect(result.issues.some((i) => i.id === "V06")).toBe(true);
  });
});

describe("V07: AGF not registered", () => {
  it("flags when AGF path is not in GraphFilesResourceNames", () => {
    const agf = makeAgf([{ type: "AnimSrcNodeQueue", name: "Root", children: [] }]);
    const agr: ParsedAgr = {
      variables: [],
      commands: [],
      ikChains: [],
      boneMasks: [],
      globalTags: [],
      defaultRunNode: "Root",
      agfReferences: ["{GUID}other.agf"],
      astReference: null,
    };
    const result = validateGraph(agf, agr, undefined, "my_graph.agf");
    expect(result.issues.some((i) => i.id === "V07")).toBe(true);
  });
});

describe("V08: 2-part Source format", () => {
  it("flags Source with only 2 dot-separated parts", () => {
    const agf = makeAgf([
      {
        type: "AnimSrcNodeSource",
        name: "Src",
        children: [],
        properties: { source: "Group.Anim" },
      },
    ]);
    const result = validateGraph(agf);
    expect(result.issues.some((i) => i.id === "V08")).toBe(true);
  });

  it("passes with 3-part format", () => {
    const agf = makeAgf([
      {
        type: "AnimSrcNodeSource",
        name: "Src",
        children: [],
        properties: { source: "Group.Col.Anim" },
      },
    ]);
    const result = validateGraph(agf);
    expect(result.issues.some((i) => i.id === "V08")).toBe(false);
  });
});

describe("V09: $Time in ProcTransform", () => {
  it("flags Amount expression containing $Time", () => {
    const agf = makeAgf([
      {
        type: "AnimSrcNodeProcTransform",
        name: "PT",
        children: ["BP"],
        properties: {
          expression: "1",
          boneItems: [{ bone: "root", op: "Rotate", axis: null, amount: "$Time * 2.0" }],
        },
      },
    ]);
    const result = validateGraph(agf);
    expect(result.issues.some((i) => i.id === "V09")).toBe(true);
  });
});

describe("V11: BlendN threshold order", () => {
  it("flags thresholds not in ascending order", () => {
    const agf = makeAgf([
      {
        type: "AnimSrcNodeBlendN",
        name: "BN",
        children: [],
        properties: { thresholds: ["10", "5", "20"] },
      },
    ]);
    const result = validateGraph(agf);
    expect(result.issues.some((i) => i.id === "V11")).toBe(true);
  });
});

describe("V12: State Time mode mismatch", () => {
  it("flags Notime state with non-StateMachine child", () => {
    const agf = makeAgf([
      {
        type: "AnimSrcNodeStateMachine",
        name: "SM",
        children: ["Src"],
        properties: {
          states: [
            { name: "S1", startCondition: "1", timeMode: "Notime", exit: false, child: "Src" },
          ],
          transitions: [],
        },
      },
      { type: "AnimSrcNodeSource", name: "Src", children: [] },
    ]);
    const result = validateGraph(agf);
    expect(result.issues.some((i) => i.id === "V12")).toBe(true);
  });
});

describe("V13: Unmapped Source animation", () => {
  it("flags Source with no ASI mapping", () => {
    const agf = makeAgf([
      {
        type: "AnimSrcNodeSource",
        name: "Src",
        children: [],
        properties: { source: "Loco.Erc.Walk" },
      },
    ]);
    const asi: ParsedAsi = { mappings: [] };
    const result = validateGraph(agf, undefined, asi);
    expect(result.issues.some((i) => i.id === "V13")).toBe(true);
  });
});

describe("V14: GlobalTags block missing", () => {
  it("flags when the AGR text has no GlobalTags block", () => {
    const agf = makeAgf([]);
    const agr = makeAgr({ globalTags: ["WEAPON", "STANCE"] });
    const agrContent = `AnimGraphRoot {\n GraphFilesResourceNames {}\n}`;
    const result = validateGraph(agf, agr, undefined, undefined, { agrContent });
    expect(result.issues.some((i) => i.id === "V14")).toBe(true);
  });

  it("does not flag when GlobalTags block is present (even if empty)", () => {
    const agf = makeAgf([]);
    const agr = makeAgr({ globalTags: ["WEAPON", "STANCE"] });
    const agrContent = `AnimGraphRoot {\n GlobalTags {\n  "WEAPON"\n }\n}`;
    const result = validateGraph(agf, agr, undefined, undefined, { agrContent });
    expect(result.issues.some((i) => i.id === "V14")).toBe(false);
  });

  it("is skipped when no agrContent is passed", () => {
    const agf = makeAgf([]);
    const agr = makeAgr({ globalTags: ["WEAPON", "STANCE"] });
    const result = validateGraph(agf, agr);
    expect(result.issues.some((i) => i.id === "V14")).toBe(false);
  });
});

describe("V15: GlobalTags must contain WEAPON and STANCE", () => {
  it("flags both missing entries as errors", () => {
    const agf = makeAgf([]);
    const agr = makeAgr({ globalTags: [] });
    const result = validateGraph(agf, agr);
    const v15 = result.issues.filter((i) => i.id === "V15");
    expect(v15).toHaveLength(2);
    expect(v15.every((i) => i.severity === "error")).toBe(true);
    expect(v15.some((i) => i.message.includes("WEAPON"))).toBe(true);
    expect(v15.some((i) => i.message.includes("STANCE"))).toBe(true);
  });

  it("flags only the missing one when partially complete", () => {
    const agf = makeAgf([]);
    const agr = makeAgr({ globalTags: ["WEAPON"] });
    const result = validateGraph(agf, agr);
    const v15 = result.issues.filter((i) => i.id === "V15");
    expect(v15).toHaveLength(1);
    expect(v15[0].message).toContain("STANCE");
  });

  it("passes when both are present", () => {
    const agf = makeAgf([]);
    const agr = makeAgr({ globalTags: ["WEAPON", "STANCE", "EXTRA"] });
    const result = validateGraph(agf, agr);
    expect(result.issues.some((i) => i.id === "V15")).toBe(false);
  });

  it("is silent when no AGR is supplied", () => {
    const result = validateGraph(makeAgf([]));
    expect(result.issues.some((i) => i.id === "V15")).toBe(false);
  });
});

describe("V16: PascalCase state names", () => {
  it("flags snake_case state names", () => {
    const agf = makeAgf([
      {
        type: "AnimSrcNodeStateMachine",
        name: "SM",
        children: [],
        properties: {
          states: [
            { name: "walk_forward", startCondition: "1", timeMode: "Normtime", exit: false, child: null },
          ],
          transitions: [],
        },
      },
    ]);
    const result = validateGraph(agf);
    expect(result.issues.some((i) => i.id === "V16" && i.message.includes("walk_forward"))).toBe(
      true,
    );
  });

  it("flags all-lowercase state names", () => {
    const agf = makeAgf([
      {
        type: "AnimSrcNodeStateMachine",
        name: "SM",
        children: [],
        properties: {
          states: [
            { name: "idle", startCondition: "1", timeMode: "Normtime", exit: false, child: null },
          ],
          transitions: [],
        },
      },
    ]);
    const result = validateGraph(agf);
    expect(result.issues.some((i) => i.id === "V16" && i.message.includes("idle"))).toBe(true);
  });

  it("passes PascalCase names like WalkForward", () => {
    const agf = makeAgf([
      {
        type: "AnimSrcNodeStateMachine",
        name: "SM",
        children: [],
        properties: {
          states: [
            { name: "WalkForward", startCondition: "1", timeMode: "Normtime", exit: false, child: null },
          ],
          transitions: [],
        },
      },
    ]);
    const result = validateGraph(agf);
    expect(result.issues.some((i) => i.id === "V16")).toBe(false);
  });
});

describe("V17: referenced .anm clip file existence", () => {
  it("flags an ASI mapping whose anm path does not exist on disk", () => {
    const tmp = mkdtempSync(join(tmpdir(), "anm-test-"));
    const agf = makeAgf([]);
    const asi: ParsedAsi = {
      mappings: [
        {
          group: "Loco",
          column: "Erc",
          animation: "Walk",
          anmPath: "{ABCDEF0123456789}anims/missing.anm",
        },
      ],
    };
    const result = validateGraph(agf, undefined, asi, undefined, { projectRoot: tmp });
    expect(result.issues.some((i) => i.id === "V17" && i.severity === "error")).toBe(true);
  });

  it("passes when the .anm file is on disk", () => {
    const tmp = mkdtempSync(join(tmpdir(), "anm-test-"));
    mkdirSync(join(tmp, "anims"), { recursive: true });
    writeFileSync(join(tmp, "anims", "present.anm"), "stub", "utf-8");
    const agf = makeAgf([]);
    const asi: ParsedAsi = {
      mappings: [
        {
          group: "Loco",
          column: "Erc",
          animation: "Walk",
          anmPath: "{ABCDEF0123456789}anims/present.anm",
        },
      ],
    };
    const result = validateGraph(agf, undefined, asi, undefined, { projectRoot: tmp });
    expect(result.issues.some((i) => i.id === "V17")).toBe(false);
  });

  it("is skipped when no projectRoot is supplied", () => {
    const agf = makeAgf([]);
    const asi: ParsedAsi = {
      mappings: [{ group: "G", column: "C", animation: "A", anmPath: "{X}does/not/exist.anm" }],
    };
    const result = validateGraph(agf, undefined, asi);
    expect(result.issues.some((i) => i.id === "V17")).toBe(false);
  });
});

describe("V18: m_BoneRemap references unknown bones", () => {
  it("flags bones not present in the supplied skeleton", () => {
    const agrContent = `AnimGraphRoot {\n m_BoneRemap {\n  "FakeBone"\n  "Spine_01"\n }\n}`;
    const agr = makeAgr({ globalTags: ["WEAPON", "STANCE"] });
    const result = validateGraph(makeAgf([]), agr, undefined, undefined, {
      agrContent,
      skeleton: { bones: ["Spine_01", "Pelvis", "Head"] },
    });
    expect(result.issues.some((i) => i.id === "V18" && i.message.includes("FakeBone"))).toBe(true);
    expect(result.issues.some((i) => i.id === "V18" && i.message.includes("Spine_01"))).toBe(
      false,
    );
  });

  it("is silent when no m_BoneRemap block is present", () => {
    const agrContent = `AnimGraphRoot {\n GlobalTags { "WEAPON" "STANCE" }\n}`;
    const agr = makeAgr({ globalTags: ["WEAPON", "STANCE"] });
    const result = validateGraph(makeAgf([]), agr, undefined, undefined, {
      agrContent,
      skeleton: { bones: ["Pelvis"] },
    });
    expect(result.issues.some((i) => i.id === "V18")).toBe(false);
  });

  it("is skipped when no skeleton is supplied", () => {
    const agrContent = `AnimGraphRoot {\n m_BoneRemap {\n  "FakeBone"\n }\n}`;
    const agr = makeAgr({ globalTags: ["WEAPON", "STANCE"] });
    const result = validateGraph(makeAgf([]), agr, undefined, undefined, { agrContent });
    expect(result.issues.some((i) => i.id === "V18")).toBe(false);
  });
});

describe("empty graph", () => {
  it("returns PASSED with zero issues", () => {
    const result = validateGraph({ sheets: [] });
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
  });
});
