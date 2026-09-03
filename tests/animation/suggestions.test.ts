import { describe, it, expect } from "vitest";
import { generateSuggestions } from "../../src/animation/suggestions.js";
import type { ParsedAgf } from "../../src/animation/types.js";

describe("Performance: Blend without Optimization", () => {
  it("suggests enabling Optimization on variable-driven Blend", () => {
    const agf: ParsedAgf = {
      sheets: [
        {
          name: "Main",
          nodes: [
            {
              type: "AnimSrcNodeBlend",
              name: "B1",
              children: ["A", "B"],
              properties: { blendWeight: "AimWeight", optimization: false },
              editorPos: { x: 0, y: 0 },
              raw: "",
            },
          ],
        },
      ],
    };
    const suggestions = generateSuggestions(agf);
    expect(suggestions.some((s) => s.category === "Performance")).toBe(true);
  });
});

describe("Smoothing: Instant transitions", () => {
  it("suggests smoothing for Duration 0.0", () => {
    const agf: ParsedAgf = {
      sheets: [
        {
          name: "Main",
          nodes: [
            {
              type: "AnimSrcNodeStateMachine",
              name: "SM",
              children: [],
              properties: {
                states: [
                  {
                    name: "A",
                    startCondition: "1",
                    timeMode: "Normtime",
                    exit: false,
                    child: null,
                  },
                ],
                transitions: [
                  {
                    from: "A",
                    to: "B",
                    condition: "x",
                    duration: "0.0",
                    postEval: false,
                    blendFn: null,
                    startTime: null,
                  },
                ],
              },
              editorPos: { x: 0, y: 0 },
              raw: "",
            },
          ],
        },
      ],
    };
    const suggestions = generateSuggestions(agf);
    expect(suggestions.some((s) => s.category === "Smoothing")).toBe(true);
  });
});

describe("Flexibility: Hardcoded ProcTransform Amount", () => {
  it("suggests variable for hardcoded numeric Amount", () => {
    const agf: ParsedAgf = {
      sheets: [
        {
          name: "Main",
          nodes: [
            {
              type: "AnimSrcNodeProcTransform",
              name: "PT",
              children: ["BP"],
              properties: {
                expression: "1",
                boneItems: [
                  { bone: "root", op: "Rotate", axis: null, amount: "GetUpperRTime() * 2.094" },
                ],
              },
              editorPos: { x: 0, y: 0 },
              raw: "",
            },
          ],
        },
      ],
    };
    const suggestions = generateSuggestions(agf);
    expect(suggestions.some((s) => s.category === "Flexibility")).toBe(true);
  });
});

describe("Robustness: Queue items without InterruptExpr", () => {
  it("suggests adding InterruptExpr", () => {
    const agf: ParsedAgf = {
      sheets: [
        {
          name: "Main",
          nodes: [
            {
              type: "AnimSrcNodeQueue",
              name: "Q",
              children: ["C"],
              properties: {
                queueItems: [
                  {
                    child: "C",
                    startExpr: "IsCommand(CMD_Reload)",
                    interruptExpr: null,
                    blendInTime: "0.2",
                    blendOutTime: "0.3",
                    enqueueMethod: "Replace",
                    tagMainPath: null,
                  },
                ],
              },
              editorPos: { x: 0, y: 0 },
              raw: "",
            },
          ],
        },
      ],
    };
    const suggestions = generateSuggestions(agf);
    expect(suggestions.some((s) => s.category === "Robustness")).toBe(true);
  });
});
