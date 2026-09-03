import { describe, it, expect } from "vitest";
import { parseAgfToStruct } from "../../src/animation/parser.js";

const SAMPLE_AGF = `AnimSrcGraphFile {
 Sheets {
  AnimSrcGraphSheet MainSheet {
   Nodes {
    AnimSrcNodeQueue MasterQueue {
     EditorPos 0 0
     Child "LocoSM"
     AnimSrcNodeQueueItem {
      Child "ReloadAction"
      StartExpr "IsCommand(CMD_Reload)"
      InterruptExpr "IsCommand(CMD_Cancel)"
      BlendInTime 0.2
      BlendOutTime 0.3
      EnqueueMethod Replace
     }
    }
    AnimSrcNodeStateMachine LocoSM {
     EditorPos 2 0
     AnimSrcNodeState Idle {
      StartCondition "Speed == 0"
      Time Normtime
      Child "IdleSrc"
     }
     AnimSrcNodeState Walk {
      StartCondition "Speed > 0"
      Time Realtime
      Child "WalkBlend"
     }
     AnimSrcNodeState Fallback {
      StartCondition "1"
      Time Notime
      Child "FallbackSM"
     }
     AnimSrcNodeTransition {
      From "Idle"
      To "Walk"
      Condition "Speed > 0.1"
      Duration 0.3
      PostEval 1
      BlendFn S
     }
    }
    AnimSrcNodeSource IdleSrc {
     EditorPos 4 0
     Source "Locomotion.Erc.Idle"
    }
    AnimSrcNodeProcTransform Spin {
     EditorPos 6 0
     Child "BindPose"
     Expression "1"
     Bones {
      AnimSrcNodeProcTrBoneItem "{A1B2}" {
       Bone "wheel_fl"
       Op Rotate
       Axis Y
       Amount "GetUpperRTime() * RotationSpeed"
      }
      AnimSrcNodeProcTrBoneItem "{C3D4}" {
       Bone "wheel_fr"
       Op Rotate
       Amount "GetUpperRTime() * 2.094"
      }
     }
    }
    AnimSrcNodeBlend AimBlend {
     EditorPos 8 0
     Child0 "BasePose"
     Child1 "AimPose"
     BlendWeight "AimWeight"
     Optimization 1
    }
    AnimSrcNodeBindPose BindPose {
     EditorPos 10 0
    }
    AnimSrcNodeUnknownFuture CustomNode {
     EditorPos 12 0
     Child "BindPose"
     SomeCustomProp 42
    }
   }
  }
 }
}`;

describe("parseAgfToStruct", () => {
  const result = parseAgfToStruct(SAMPLE_AGF);

  it("parses sheets and node count", () => {
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].name).toBe("MainSheet");
    expect(result.sheets[0].nodes.length).toBeGreaterThanOrEqual(7);
  });

  it("parses Queue with child and queue items", () => {
    const queue = result.sheets[0].nodes.find((n) => n.name === "MasterQueue")!;
    expect(queue.type).toBe("AnimSrcNodeQueue");
    expect(queue.children).toContain("LocoSM");
    const items = queue.properties.queueItems as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0].child).toBe("ReloadAction");
    expect(items[0].startExpr).toBe("IsCommand(CMD_Reload)");
    expect(items[0].interruptExpr).toBe("IsCommand(CMD_Cancel)");
    expect(items[0].enqueueMethod).toBe("Replace");
  });

  it("parses StateMachine with states and transitions", () => {
    const sm = result.sheets[0].nodes.find((n) => n.name === "LocoSM")!;
    expect(sm.type).toBe("AnimSrcNodeStateMachine");
    const states = sm.properties.states as Array<Record<string, unknown>>;
    expect(states).toHaveLength(3);
    expect(states[0].name).toBe("Idle");
    expect(states[0].startCondition).toBe("Speed == 0");
    expect(states[0].timeMode).toBe("Normtime");
    expect(states[2].startCondition).toBe("1");

    const transitions = sm.properties.transitions as Array<Record<string, unknown>>;
    expect(transitions).toHaveLength(1);
    expect(transitions[0].from).toBe("Idle");
    expect(transitions[0].to).toBe("Walk");
    expect(transitions[0].condition).toBe("Speed > 0.1");
    expect(transitions[0].duration).toBe("0.3");
    expect(transitions[0].postEval).toBe(true);
    expect(transitions[0].blendFn).toBe("S");

    // States add children
    expect(sm.children).toContain("IdleSrc");
    expect(sm.children).toContain("WalkBlend");
    expect(sm.children).toContain("FallbackSM");
  });

  it("parses Source with animation reference", () => {
    const src = result.sheets[0].nodes.find((n) => n.name === "IdleSrc")!;
    expect(src.type).toBe("AnimSrcNodeSource");
    expect(src.properties.source).toBe("Locomotion.Erc.Idle");
  });

  it("parses ProcTransform with bone items", () => {
    const pt = result.sheets[0].nodes.find((n) => n.name === "Spin")!;
    expect(pt.type).toBe("AnimSrcNodeProcTransform");
    expect(pt.children).toContain("BindPose");
    expect(pt.properties.expression).toBe("1");
    const bones = pt.properties.boneItems as Array<Record<string, unknown>>;
    expect(bones).toHaveLength(2);
    expect(bones[0].bone).toBe("wheel_fl");
    expect(bones[0].op).toBe("Rotate");
    expect(bones[0].axis).toBe("Y");
    expect(bones[0].amount).toBe("GetUpperRTime() * RotationSpeed");
    expect(bones[1].axis).toBeNull(); // no Axis = default X
  });

  it("parses Blend with weights and optimization", () => {
    const blend = result.sheets[0].nodes.find((n) => n.name === "AimBlend")!;
    expect(blend.type).toBe("AnimSrcNodeBlend");
    expect(blend.children).toContain("BasePose");
    expect(blend.children).toContain("AimPose");
    expect(blend.properties.blendWeight).toBe("AimWeight");
    expect(blend.properties.optimization).toBe(true);
  });

  it("handles unknown node types with generic extraction", () => {
    const unknown = result.sheets[0].nodes.find((n) => n.name === "CustomNode")!;
    expect(unknown.type).toBe("AnimSrcNodeUnknownFuture");
    expect(unknown.children).toContain("BindPose");
  });

  it("handles empty AGF gracefully", () => {
    const empty = parseAgfToStruct("AnimSrcGraphFile {\n Sheets {\n }\n}");
    expect(empty.sheets).toHaveLength(0);
  });
});
