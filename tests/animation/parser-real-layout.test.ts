import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseAgfToStruct, parseAsiToStruct } from "../../src/animation/parser.js";
import type { ParsedIkBinding, ParsedTransition } from "../../src/animation/types.js";
import { loadConfig } from "../../src/config.js";
import { PakVirtualFS } from "../../src/pak/vfs.js";

// Layout from vanilla Assets/Weapons/MachineGuns/workspaces/M60_tripod.agf and
// M998_door_roof.agf: GUID-named transitions and IK bindings, FromState/ToState.
const AGF = `AnimSrcGraph {
 Sheets {
  AnimSrcGraphSheet Main {
   Nodes {
    AnimSrcNodeStateMachine TripodSTM {
     EditorPos 390 153.698
     states {
      AnimSrcNodeState AimIdle {
       IsExit 1
       Child "AimspaceMainSRC"
      }
      AnimSrcNodeState TurnR {
       Child "TurnRAimspaceB"
       TimeStorage "Real Time"
      }
     }
     transitions {
      AnimSrcNodeTransition "{59B8792CF40F1BC6}" {
       FromState "AimIdle"
       ToState "TurnR"
       Duration "0.2"
       Condition "IsCommand(CMD_Locomotion_Turn)"
      }
      AnimSrcNodeTransition "{59B8792CF40F1BEB}" {
       FromState "TurnR"
       ToState "AimIdle"
       Duration "0.2"
       PostEval 1
      }
     }
    }
    AnimSrcNodeIK2Target ModesIKTarget {
     Child "Q"
     Chains {
      AnimSrcIkTargetBinding "{5496D84E3C6AD625}" {
       IkTarget "LHandIKTarget"
       IkChain "Head"
       LocalSpaceOffset AnimSrcTransformOffset "{60DCB7D6ED6B0954}" {
        Position 0 0 0
       }
      }
     }
    }
    AnimSrcNodeIK2 SteerIK {
     Child "Q"
     Chains {
      AnimSrcIkBinding "{52C4E32EA69C695E}" {
       IkTarget "LHandIKTarget"
       IkChain "LeftArm"
      }
      AnimSrcIkBinding "{52C4E32EA69C6957}" {
       IkTarget "RHandIKTarget"
       IkChain "RightArm"
      }
     }
    }
   }
  }
 }
}`;

describe("agf real layout", () => {
  const sheet = parseAgfToStruct(AGF).sheets[0];
  it("reads GUID-named transitions with FromState/ToState", () => {
    const sm = sheet.nodes.find((n) => n.type === "AnimSrcNodeStateMachine")!;
    const t = sm.properties.transitions as ParsedTransition[];
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ from: "AimIdle", to: "TurnR", duration: "0.2" });
    expect(t[1].postEval).toBe(true);
    const states = sm.properties.states as Array<{ exit: boolean; timeMode: string | null }>;
    expect(states).toHaveLength(2);
    expect(states[0].exit).toBe(true);
    expect(states[1].timeMode).toBe("Real Time");
  });
  it("reads IK bindings", () => {
    const ik = sheet.nodes.find((n) => n.type === "AnimSrcNodeIK2")!;
    const c = ik.properties.chains as ParsedIkBinding[];
    expect(c.map((x) => x.ikChain)).toEqual(["LeftArm", "RightArm"]);
  });
});

describe("agf IK2Target", () => {
  it("reads AnimSrcIkTargetBinding chains", () => {
    const n = parseAgfToStruct(AGF).sheets[0].nodes.find((x) => x.name === "ModesIKTarget")!;
    expect(n.properties.chains).toEqual([{ ikTarget: "LHandIKTarget", ikChain: "Head" }]);
  });
});

describe("asi real layout", () => {
  it("splits Group.Column.Animation and strips the GUID prefix", () => {
    const r = parseAsiToStruct(`AnimSetInstanceSource "{1}" {
 Lines {
  AnimSetInstanceSource_Line "Gadget.CroRas.Focused" {
   Resource "{E026D5F801FAF110}a/b/c.anm"
  }
 }
}`);
    expect(r.mappings).toEqual([
      { group: "Gadget", column: "CroRas", animation: "Focused", anmPath: "a/b/c.anm" },
    ]);
  });
});

describe("corpus sample (skips without the game)", () => {
  let vfs: PakVirtualFS | undefined;
  try {
    const g = loadConfig().gamePath;
    if (existsSync(join(g, "addons"))) vfs = PakVirtualFS.get(g) ?? undefined;
  } catch {
    vfs = undefined;
  }
  it.skipIf(!vfs)(
    "reads every transition and ASI line in the sampled files",
    () => {
      const paths = vfs!.allFilePaths();
      const agf = paths.filter((p) => p.endsWith(".agf")).slice(0, 8);
      const asi = paths.filter((p) => p.endsWith(".asi")).slice(0, 8);
      for (const p of agf) {
        const text = vfs!.readFile(p).toString("utf-8");
        const want = text.match(/^[ \t]*AnimSrcNodeTransition\b[^\n]*\{[ \t]*\r?$/gm)?.length ?? 0;
        let got = 0;
        for (const sh of parseAgfToStruct(text).sheets)
          for (const n of sh.nodes)
            got += (n.properties.transitions as unknown[] | undefined)?.length ?? 0;
        expect(got, p).toBe(want);
      }
      for (const p of asi) {
        const text = vfs!.readFile(p).toString("utf-8");
        const want =
          text.match(/^[ \t]*AnimSetInstanceSource_Line\b[^\n]*\{[ \t]*\r?$/gm)?.length ?? 0;
        expect(parseAsiToStruct(text).mappings.length, p).toBe(want);
      }
    },
    60000,
  );
});
