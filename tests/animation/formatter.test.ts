import { describe, it, expect } from "vitest";
import { formatAgfTree, formatAgrSummary } from "../../src/animation/formatter.js";
import type { ParsedAgf, ParsedAgr } from "../../src/animation/types.js";

describe("formatAgfTree", () => {
  it("renders summary header with node counts", () => {
    const agf: ParsedAgf = {
      sheets: [
        {
          name: "Main",
          nodes: [
            {
              type: "AnimSrcNodeQueue",
              name: "MQ",
              children: ["Child1"],
              properties: { queueItems: [] },
              editorPos: { x: 0, y: 0 },
              raw: "",
            },
            {
              type: "AnimSrcNodeBindPose",
              name: "Child1",
              children: [],
              properties: {},
              editorPos: { x: 2, y: 0 },
              raw: "",
            },
          ],
        },
      ],
    };
    const output = formatAgfTree(agf);
    expect(output).toContain("Sheets: 1");
    expect(output).toContain("Nodes: 2");
    expect(output).toContain("1 Queue");
    expect(output).toContain("1 BindPose");
  });

  it("renders parent-child tree with indentation", () => {
    const agf: ParsedAgf = {
      sheets: [
        {
          name: "Main",
          nodes: [
            {
              type: "AnimSrcNodeQueue",
              name: "Root",
              children: ["Mid"],
              properties: { queueItems: [] },
              editorPos: { x: 0, y: 0 },
              raw: "",
            },
            {
              type: "AnimSrcNodeBlend",
              name: "Mid",
              children: ["Leaf"],
              properties: { blendWeight: "0.5" },
              editorPos: { x: 2, y: 0 },
              raw: "",
            },
            {
              type: "AnimSrcNodeBindPose",
              name: "Leaf",
              children: [],
              properties: {},
              editorPos: { x: 4, y: 0 },
              raw: "",
            },
          ],
        },
      ],
    };
    const output = formatAgfTree(agf);
    expect(output).toContain('Queue "Root"');
    expect(output).toContain('Blend "Mid"');
    expect(output).toContain('BindPose "Leaf"');
  });

  it("marks cross-references with (see above)", () => {
    const agf: ParsedAgf = {
      sheets: [
        {
          name: "Main",
          nodes: [
            {
              type: "AnimSrcNodeQueue",
              name: "Root",
              children: ["Shared"],
              properties: { queueItems: [] },
              editorPos: { x: 0, y: 0 },
              raw: "",
            },
            {
              type: "AnimSrcNodeBlend",
              name: "Blend1",
              children: ["Shared"],
              properties: {},
              editorPos: { x: 2, y: 0 },
              raw: "",
            },
            {
              type: "AnimSrcNodeBindPose",
              name: "Shared",
              children: [],
              properties: {},
              editorPos: { x: 4, y: 0 },
              raw: "",
            },
          ],
        },
      ],
    };
    const output = formatAgfTree(agf);
    expect(output).toContain("(see above)");
  });

  it("shows StateMachine states and transitions", () => {
    const agf: ParsedAgf = {
      sheets: [
        {
          name: "Main",
          nodes: [
            {
              type: "AnimSrcNodeStateMachine",
              name: "SM",
              children: ["IdleSrc"],
              properties: {
                states: [
                  {
                    name: "Idle",
                    startCondition: "Speed == 0",
                    timeMode: "Normtime",
                    exit: false,
                    child: "IdleSrc",
                  },
                ],
                transitions: [
                  {
                    from: "Idle",
                    to: "Walk",
                    condition: "Speed > 0",
                    duration: "0.3",
                    postEval: true,
                    blendFn: "S",
                    startTime: null,
                  },
                ],
              },
              editorPos: { x: 0, y: 0 },
              raw: "",
            },
            {
              type: "AnimSrcNodeSource",
              name: "IdleSrc",
              children: [],
              properties: { source: "Loco.Erc.Idle" },
              editorPos: { x: 2, y: 0 },
              raw: "",
            },
          ],
        },
      ],
    };
    const output = formatAgfTree(agf);
    expect(output).toContain('State "Idle"');
    expect(output).toContain("StartCondition");
    expect(output).toContain("Speed == 0");
    expect(output).toContain("Transition");
    expect(output).toContain("Speed > 0");
    expect(output).toContain("Duration: 0.3");
  });

  it("handles empty AGF", () => {
    const output = formatAgfTree({ sheets: [] });
    expect(output).toContain("Sheets: 0");
    expect(output).toContain("Nodes: 0");
  });
});

describe("formatAgrSummary", () => {
  it("renders variables, commands, IK chains, bone masks", () => {
    const agr: ParsedAgr = {
      variables: [{ name: "Speed", type: "Float", min: "0", max: "30", defaultValue: "0" }],
      commands: [{ name: "CMD_Fire" }],
      ikChains: [{ name: "LeftLeg", joints: ["a", "b"], middleJoint: "b", chainAxis: "+y" }],
      boneMasks: [{ name: "Upper", bones: ["spine"] }],
      globalTags: ["Vehicle"],
      defaultRunNode: "MQ",
      agfReferences: ["path.agf"],
      astReference: "path.ast",
    };
    const output = formatAgrSummary(agr);
    expect(output).toContain("Speed");
    expect(output).toContain("Float");
    expect(output).toContain("CMD_Fire");
    expect(output).toContain("LeftLeg");
    expect(output).toContain("Vehicle");
    expect(output).toContain("MQ");
  });
});
