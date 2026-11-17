/**
 * `animation_graph`: animation graph files (.agr .agf .ast .asi .aw), offline.
 *
 * Wave W4 (phase5-w4-spec.md 2.4, 4; DEC-067): the readers walk the lossless
 * parser (src/formats/enfusion-cst.ts); validate runs the re-grounded rules
 * (every 1.x rule that fires on vanilla is a warning, OD-4); nodes lists the
 * Animation Editor's classes from the census index (node-catalog.ts); edit
 * changes .agf/.agr files in the project through lossless splices
 * (src/animation/graph-edit.ts), a dry run unless confirm:true, with a
 * `.bak` copy of the file before a write.
 *
 * The 1.x actions stay: author and setup as they were, inspect (with
 * inspectAction=validate as the alias of validate).
 *
 * New actions answer {ok, action, target, changed, readback, next, warnings}
 * (src/manifest/vocabulary.ts) as JSON text. No Workbench call.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { writeFileAtomic } from "../utils/atomic-write.js";
import { backUp, backupRel } from "../utils/backup.js";
import { dirname, extname, join, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";
import { validateProjectPath } from "../utils/safe-path.js";
import { assertInsideRoot, pinnedProjectRoot } from "../utils/path-guard.js";
import { PakVirtualFS } from "../pak/vfs.js";
import {
  CstEditError,
  parseCstBytes,
  type CstDocument,
  type CstEntry,
} from "../formats/enfusion-cst.js";
import {
  VocabularyError,
  checkCursor,
  checkRelativePath,
  errorResponse,
  nextCursor,
  parseCursor,
  LIMIT_DEFAULT,
  LIMIT_MAX,
  type ActionResponse,
  type ErrorCode,
} from "../manifest/vocabulary.js";
import {
  parseAgrDoc,
  parseAgfDoc,
  parseAgrToStruct,
  parseAgfToStruct,
  parseAstToStruct,
  parseAsiToStruct,
  parseAwToStruct,
} from "../animation/parser.js";
import {
  formatAgrSummary,
  formatAgfTree,
  formatAstSummary,
  formatAsiSummary,
  formatAwSummary,
  formatValidationReport,
} from "../animation/formatter.js";
import { generateSuggestions, formatSuggestions } from "../animation/suggestions.js";
import { generateGuide } from "../animation/guides.js";
import { validateGraph } from "../animation/validator.js";
import type { ParsedAgf, ParsedAgr, ParsedAsi, ValidationIssue } from "../animation/types.js";
import {
  NODE_CATALOG_BUILD,
  catalog,
  catalogClass,
  catalogEnums,
  type CatalogKind,
} from "../animation/node-catalog.js";
import {
  GRAPH_OPS,
  VAR_TYPES,
  applyGraphEdit,
  opExtension,
  type GraphEditOp,
  type GraphOp,
  type PropValue,
} from "../animation/graph-edit.js";
import { lineDiff } from "./config-edit.js";

// ── Shared interface ──────────────────────────────────────────────────────────

interface VehicleConfig {
  vehicleName: string;
  vehicleType: string;
  wheelCount: number;
  hasTurret: boolean;
  hasSuspensionIK: boolean;
  hasShockAbsorbers: boolean;
  hasSteeringLinkage: boolean;
  seatTypes: string[];
  dialList: string[];
}

// ── Author helpers (from animation-graph-author.ts) ───────────────────────────

function generateAgrAuthor(cfg: VehicleConfig): string {
  const lines: string[] = [];

  lines.push("AnimSrcGraph {");
  lines.push(
    ` AnimSetTemplate "{PLACEHOLDER_GUID}${cfg.vehicleType}/${cfg.vehicleName}/workspaces/${cfg.vehicleName}.ast"`,
  );
  lines.push(' ControlTemplate AnimSrcGCT "{PLACEHOLDER_GUID_2}" {');

  // Variables
  lines.push("  Variables {");

  // Standard vehicle variables — order follows LAV25 pattern
  lines.push("   AnimSrcGCTVarFloat VehicleSteering {");
  lines.push("    MinValue -1");
  lines.push("    MaxValue 1");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat VehicleThrottle {");
  lines.push("    MaxValue 1");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat VehicleClutch {");
  lines.push("    MaxValue 1");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat VehicleBrake {");
  lines.push("    MaxValue 1");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat VehicleAccelerationLR {");
  lines.push("    MinValue -1");
  lines.push("    MaxValue 1");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat VehicleAccelerationFB {");
  lines.push("    MinValue -1");
  lines.push("    MaxValue 1");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat LookX {");
  lines.push("    MinValue -180");
  lines.push("    MaxValue 180");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat LookY {");
  lines.push("    MinValue -180");
  lines.push("    MaxValue 180");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarInt SeatPositionType {");
  lines.push("    MaxValue 10");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat AimY {");
  lines.push("    MinValue -100");
  lines.push("    MaxValue 100");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarBool Horn {");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat VehicleHandBrake {");
  lines.push("    MaxValue 2");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarBool IsDriver {");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat SpineAccelerationFB {");
  lines.push("    MinValue -1");
  lines.push("    MaxValue 1");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat Vehicle_Wobble {");
  lines.push("    MaxValue 1");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat SpineAccelerationLR {");
  lines.push("    MinValue -1");
  lines.push("    MaxValue 1");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat AimX {");
  lines.push("    MinValue -100");
  lines.push("    MaxValue 100");
  lines.push("   }");

  // Suspension variables (always included, count matches wheelCount)
  for (let i = 0; i < cfg.wheelCount; i++) {
    lines.push(`   AnimSrcGCTVarFloat suspension_${i} {`);
    lines.push("    MinValue -1");
    lines.push("    MaxValue 1");
    lines.push("   }");
  }

  lines.push("   AnimSrcGCTVarFloat Suspension_dumping {");
  lines.push("    MinValue -1");
  lines.push("    MaxValue 1");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat Suspension_shake {");
  lines.push("    MaxValue 1");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat YawAngle {");
  lines.push("    MinValue -360");
  lines.push("    MaxValue 360");
  lines.push("   }");

  // Wheel rotation variables
  for (let i = 0; i < cfg.wheelCount; i++) {
    lines.push(`   AnimSrcGCTVarFloat wheel_${i} {`);
    lines.push("    MinValue -360");
    lines.push("    MaxValue 360");
    lines.push("   }");
  }

  lines.push("   AnimSrcGCTVarFloat steering {");
  lines.push("    MinValue -50");
  lines.push("    MaxValue 50");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat Gearbox_RPM {");
  lines.push("    MinValue -10000");
  lines.push("    MaxValue 10000");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat Engine_RPM {");
  lines.push("    MaxValue 10000");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat WaterLevel {");
  lines.push("    MaxValue 100");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat IsSwimming {");
  lines.push("    MaxValue 1");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat IsInVehicle {");
  lines.push("    MaxValue 1");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat SPEED {");
  lines.push("    MinValue 0");
  lines.push("    MaxValue 250");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat Speed_dumping {");
  lines.push("    MaxValue 250");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat POWER_IO {");
  lines.push("    DefaultValue 1");
  lines.push("    MaxValue 1");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat LocalTime {");
  lines.push("    DefaultValue 100000000");
  lines.push("    MaxValue 100000000");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarBool TurnOut {");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat Yaw {");
  lines.push("    MinValue -180");
  lines.push("    MaxValue 180");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarFloat Pitch {");
  lines.push("    MinValue -50");
  lines.push("    MaxValue 80");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarInt VehicleDoorState {");
  lines.push("    MaxValue 298754968");
  lines.push("   }");

  lines.push("   AnimSrcGCTVarInt VehicleDoorType {");
  lines.push("    MaxValue 298754968");
  lines.push("   }");

  if (cfg.hasTurret) {
    lines.push("   AnimSrcGCTVarFloat TurretRot_Antennas {");
    lines.push("    DefaultValue 0");
    lines.push("    MinValue -1");
    lines.push("    MaxValue 1");
    lines.push("   }");
  }

  if (cfg.seatTypes.includes("gunner")) {
    lines.push("   AnimSrcGCTVarFloat Gunner_sights_cover {");
    lines.push("    DefaultValue -0.71");
    lines.push("    MinValue -0.71");
    lines.push("    MaxValue 1.4");
    lines.push("   }");
  }

  lines.push("  }");

  // Commands
  lines.push("  Commands {");
  lines.push("   AnimSrcGCTCmd CMD_Vehicle_SwitchSeat {");
  lines.push("   }");
  lines.push("   AnimSrcGCTCmd CMD_Unconscious {");
  lines.push("   }");
  lines.push("   AnimSrcGCTCmd CMD_Unconscious_Exit {");
  lines.push("   }");
  lines.push("   AnimSrcGCTCmd CMD_Death {");
  lines.push("   }");
  lines.push("   AnimSrcGCTCmd CMD_OpenDoor {");
  lines.push("   }");
  lines.push("   AnimSrcGCTCmd CMD_Wheeled_Action {");
  lines.push("   }");
  lines.push("   AnimSrcGCTCmd CMD_Lights {");
  lines.push("   }");
  lines.push("   AnimSrcGCTCmd CMD_Vehicle_GetIn {");
  lines.push("   }");
  lines.push("   AnimSrcGCTCmd CMD_Vehicle_GetOut {");
  lines.push("   }");
  lines.push("   AnimSrcGCTCmd CMD_Vehicle_GearSwitch {");
  lines.push("   }");
  lines.push("   AnimSrcGCTCmd CMD_Vehicle_Engine_StartStop {");
  lines.push("   }");
  lines.push("   AnimSrcGCTCmd CMD_HandBrake {");
  lines.push("   }");
  lines.push("   AnimSrcGCTCmd CMD_Vehicle_OpenDoor {");
  lines.push("   }");
  lines.push("   AnimSrcGCTCmd CMD_Vehicle_CloseDoor {");
  lines.push("   }");
  lines.push("   AnimSrcGCTCmd CMD_Vehicle_FinishActionQueue {");
  lines.push("   }");
  lines.push("  }");

  // IK Chains
  lines.push("  IkChains {");

  // Standard character limb chains
  lines.push("   AnimSrcGCTIkChain LeftLeg {");
  lines.push("    Joints {");
  lines.push('     "leftleg"');
  lines.push('     "leftlegtwist"');
  lines.push('     "leftknee"');
  lines.push('     "leftkneetwist"');
  lines.push('     "leftfoot"');
  lines.push("    }");
  lines.push('    MiddleJoint "leftknee"');
  lines.push('    ChainAxis "+y"');
  lines.push("   }");

  lines.push("   AnimSrcGCTIkChain RightLeg {");
  lines.push("    Joints {");
  lines.push('     "rightleg"');
  lines.push('     "rightlegtwist"');
  lines.push('     "rightknee"');
  lines.push('     "rightkneetwist"');
  lines.push('     "rightfoot"');
  lines.push("    }");
  lines.push('    MiddleJoint "rightknee"');
  lines.push('    ChainAxis "-y"');
  lines.push("   }");

  lines.push("   AnimSrcGCTIkChain LeftArm {");
  lines.push("    Joints {");
  lines.push('     "leftarm"');
  lines.push('     "leftarmtwist"');
  lines.push('     "leftforearm"');
  lines.push('     "leftforearmtwist"');
  lines.push('     "lefthand"');
  lines.push("    }");
  lines.push('    MiddleJoint "leftforearm"');
  lines.push('    ChainAxis "+y"');
  lines.push("   }");

  lines.push("   AnimSrcGCTIkChain RightArm {");
  lines.push("    Joints {");
  lines.push('     "rightarm"');
  lines.push('     "rightarmtwist"');
  lines.push('     "rightforearm"');
  lines.push('     "rightforearmtwist"');
  lines.push('     "righthand"');
  lines.push("    }");
  lines.push('    MiddleJoint "rightforearm"');
  lines.push('    ChainAxis "-y"');
  lines.push("   }");

  // Suspension IK chains
  if (cfg.hasSuspensionIK) {
    for (let i = 0; i < cfg.wheelCount; i++) {
      lines.push(`   AnimSrcGCTIkChain suspension${i} {`);
      lines.push("    Joints {");
      lines.push(`     "v_suspension${i}"`);
      lines.push("    }");
      lines.push("   }");
    }
  }

  // Shock absorber chains — rear wheels (indices >= wheelCount/2)
  if (cfg.hasShockAbsorbers) {
    const rearStart = Math.floor(cfg.wheelCount / 2);
    for (let i = rearStart; i < cfg.wheelCount; i++) {
      lines.push(`   AnimSrcGCTIkChain shock_absorber${i} {`);
      lines.push("    Joints {");
      lines.push(`     "v_shock_absorber${i}"`);
      lines.push("    }");
      lines.push("   }");
      lines.push(`   AnimSrcGCTIkChain shock_absorber_ikTarget${i} {`);
      lines.push("    Joints {");
      lines.push(`     "v_shock_absorber_ikTarget${i}"`);
      lines.push("    }");
      lines.push("   }");
    }
  }

  // Steering linkage chains — front wheels (first half)
  if (cfg.hasSteeringLinkage) {
    const frontCount = Math.floor(cfg.wheelCount / 2);
    for (let i = 0; i < frontCount; i++) {
      lines.push(`   AnimSrcGCTIkChain steering_axis_suspension${i} {`);
      lines.push("    Joints {");
      lines.push(`     "v_steering_axis_suspension${i}"`);
      lines.push("    }");
      lines.push("   }");
      lines.push(`   AnimSrcGCTIkChain steering_axis_body${i} {`);
      lines.push("    Joints {");
      lines.push(`     "v_steering_axis_body${i}"`);
      lines.push("    }");
      lines.push("   }");
    }
  }

  lines.push("  }");

  // Bone Masks
  lines.push("  BoneMasks {");

  // Chassis mask — wheel bones + suspension bones
  lines.push("   AnimSrcGCTBoneMask Chassis {");
  lines.push("    Bones {");

  // Generate wheel bones: L01, R01, L02, R02, etc. (pairs per axle)
  const axleCount = cfg.wheelCount / 2;
  for (let axle = 1; axle <= axleCount; axle++) {
    const axleStr = String(axle).padStart(2, "0");
    lines.push(`     "v_wheel_L${axleStr}"`);
    lines.push(`     "v_wheel_R${axleStr}"`);
  }

  // Suspension bones if IK enabled
  if (cfg.hasSuspensionIK) {
    for (let i = 0; i < cfg.wheelCount; i++) {
      lines.push(`     "v_suspension${i}"`);
    }
  }

  lines.push("    }");
  lines.push("   }");

  // Body mask — empty, user fills in
  lines.push("   AnimSrcGCTBoneMask Body {");
  lines.push("    Bones {");
  lines.push("    }");
  lines.push("   }");

  // Turret masks
  if (cfg.hasTurret) {
    lines.push("   AnimSrcGCTBoneMask Turret {");
    lines.push("    Bones {");
    lines.push("    }");
    lines.push("   }");
    lines.push("   AnimSrcGCTBoneMask Turret_Pose {");
    lines.push("    Bones {");
    lines.push('     "v_root"');
    lines.push('     "v_turret_slot"');
    lines.push('     "v_turret_01"');
    lines.push("    }");
    lines.push("   }");
  }

  lines.push("  }");

  // Global Tags
  lines.push("  GlobalTags {");
  lines.push('   "VEHICLE"');
  lines.push('   "WHEELED"');
  lines.push(`   "${cfg.vehicleName.toUpperCase()}"`);
  lines.push("  }");

  lines.push(" }");
  lines.push(' Debug AnimSrcGD "{PLACEHOLDER_GUID_3}" {');
  lines.push(" }");
  lines.push(" GraphFilesResourceNames {");
  lines.push(" }");
  lines.push(' DefaultRunNode "MasterControl"');
  lines.push("}");

  return lines.join("\n");
}

function generateAstAuthor(cfg: VehicleConfig): string {
  const seatGroupMap: Record<string, string> = {
    driver: "Driver",
    gunner: "Gunner",
    commander: "Commander",
    passenger: "Passenger",
  };

  const animsByGroup: Record<string, string[]> = {
    Driver: ["Idle", "Drive", "GetIn", "GetOut", "Death"],
    Gunner: ["Idle", "Aim", "GetIn", "GetOut", "Death"],
    Commander: ["Idle", "GetIn", "GetOut", "Death"],
    Passenger: ["Idle", "GetIn", "GetOut", "Death"],
  };

  const lines: string[] = [];
  lines.push("AnimSetTemplateSource {");
  lines.push(" Groups {");

  for (const seatType of cfg.seatTypes) {
    const groupName = seatGroupMap[seatType] ?? seatType;
    const anims = animsByGroup[groupName] ?? ["Idle", "GetIn", "GetOut", "Death"];

    lines.push('  AnimSetTemplateSource_AnimationGroup "{PLACEHOLDER_GUID}" {');
    lines.push(`   Name "${groupName}"`);
    lines.push("   Animations {");
    for (const anim of anims) {
      lines.push(`    "${anim}"`);
    }
    lines.push("   }");
    lines.push("   Columns {");
    lines.push('    "Default"');
    lines.push("   }");
    lines.push("  }");
  }

  lines.push(" }");
  lines.push("}");

  return lines.join("\n");
}

// ── Instruction generators (from animation-graph-setup.ts) ───────────────────

function generateAgfInstructions(cfg: VehicleConfig): string {
  const parts: string[] = [];

  parts.push("## AGF Node Graph — Workbench UI Instructions");
  parts.push("");
  parts.push("These nodes must be added via the Animation Editor UI in Workbench.");
  parts.push("Do NOT edit the .agf file directly — Workbench re-serializes it on open.");
  parts.push("");
  parts.push("### 1. Start from a Base Game Workspace (Recommended)");
  parts.push("The fastest way to build the AGF is to duplicate an existing vehicle workspace:");
  parts.push("- In Workbench Asset Browser, find a similar base game .aw file");
  parts.push("  (e.g. Assets/Vehicles/Wheeled/S105/workspace/S105.aw for a 4-wheel vehicle)");
  parts.push("  (e.g. Assets/Vehicles/Wheeled/LAV25/workspaces/LAV25.aw for an 8-wheel vehicle)");
  parts.push("- Double-click the .aw file to open it in the Animation Editor");
  parts.push("- In the Animation Editor: Edit menu -> Duplicate Project");
  parts.push(
    "- Choose your mod output folder — Workbench copies ALL files (AGR, AGF, AST, ASI, AW)",
  );
  parts.push("  with new GUIDs assigned automatically");
  parts.push("- Rename the files to match your vehicle name");
  parts.push("- Edit the duplicated AGR (variables, IK chains, bone masks) to match your vehicle");
  parts.push("- Edit the node graph in the Animation Editor using the steps below");
  parts.push("");
  parts.push("Alternative: If building from scratch without a base to duplicate:");
  parts.push(`- Open the generated ${cfg.vehicleName}.agr in the Animation Editor`);
  parts.push(`- Go to Edit -> New Graph File, save as ${cfg.vehicleName}.agf in the same folder`);
  parts.push("- The AGF will appear in GraphFilesResourceNames automatically");
  parts.push("");
  parts.push("### 2. Create the Master Sheet");
  parts.push("- In the Animation Editor, you should see a default sheet");
  parts.push('- Rename it to "Master" (right-click the sheet tab)');
  parts.push("");
  parts.push("### 3. Add the Master Queue Node");
  parts.push("- Right-click canvas -> Add Node -> Queue");
  parts.push("- Name it: MasterControl");
  parts.push("- This is your DefaultRunNode (must match AGR setting)");
  parts.push("- Set BlendInTime: 0, BlendOutTime: 0");
  parts.push("");
  parts.push("### 4. Add Sleep Optimization Node");
  parts.push("- Right-click -> Add Node -> Sleep");
  parts.push("- Name it: MasterSleep");
  parts.push("- AwakeExpr: IsInVehicle");
  parts.push("- Timeout: 2");
  parts.push("- Connect MasterQueue.Child -> MasterSleep");
  parts.push("");
  parts.push("### 5. Chassis Branch — Wheel Rotation");
  parts.push("Add one AnimSrcNodeProcTransform per wheel:");

  const axleCount = Math.floor(cfg.wheelCount / 2);
  let wheelIndex = 0;
  for (let axle = 1; axle <= axleCount; axle++) {
    const axleStr = String(axle).padStart(2, "0");
    const leftIdx = wheelIndex;
    const rightIdx = wheelIndex + 1;
    parts.push("- Right-click -> Add Node -> Procedural (AnimSrcNodeProcTransform)");
    parts.push(`  Name: WheelLeft${axle}Rot`);
    parts.push(`  Bone: v_wheel_L${axleStr}`);
    parts.push("  Op: Rotate, Space: Local");
    parts.push(`  Amount: wheel_${leftIdx}`);
    parts.push("- Right-click -> Add Node -> Procedural (AnimSrcNodeProcTransform)");
    parts.push(`  Name: WheelRight${axle}Rot`);
    parts.push(`  Bone: v_wheel_R${axleStr}`);
    parts.push("  Op: Rotate, Space: Local");
    parts.push(`  Amount: wheel_${rightIdx}`);
    wheelIndex += 2;
  }
  parts.push("Note: If wheels spin backwards, negate the amount expression (e.g. -wheel_0).");

  if (cfg.hasSuspensionIK) {
    parts.push("");
    parts.push("### 6. Suspension IK");
    parts.push("For each wheel add a paired IK2Target + IK2 node:");
    for (let i = 0; i < cfg.wheelCount; i++) {
      parts.push(`- Add Node -> IK2Target, name: SuspensionTarget${i}`);
      parts.push(`  Variable driving target position: suspension_${i}`);
      parts.push(`- Add Node -> IK2, name: SuspensionIK${i}`);
      parts.push("  IK2.Child -> (source pose node)");
      parts.push(`  IK2.Chains -> IkChain: suspension${i}`);
      parts.push("  Set solver: TwoBoneSolver");
    }
    parts.push(
      `Bone names in IK chains must use v_suspension${0}..${cfg.wheelCount - 1} (v_ prefix mandatory).`,
    );
  }

  if (cfg.hasSteeringLinkage) {
    parts.push("");
    parts.push("### 7. Steering Linkage");
    parts.push("- Add Node -> Procedural");
    parts.push("  Bone: v_steering_axis_body0, v_steering_axis_body1");
    parts.push("  Op: Rotate, Space: Local");
    parts.push("  Amount: steering");
  }

  if (cfg.dialList.length > 0) {
    parts.push("");
    parts.push("### 8. Dials / Gauges");
    for (const dial of cfg.dialList) {
      parts.push("- Add Node -> Pose");
      parts.push('  Source: "GroupName.Column.AnimName" (replace with your animation names)');
      parts.push(`  Expression: clamp(${dial} / maxValue, 0, 1)`);
      parts.push("  0 = first frame (min position), 1 = last frame (max position)");
    }
    parts.push("All dial positions should be baked into a single animation as keyframes.");
  }

  if (cfg.hasTurret) {
    parts.push("");
    parts.push("### 9. Turret Rotation");
    parts.push("- Add Node -> Procedural");
    parts.push("  Bone: v_turret_01");
    parts.push("  Op: Rotate, Space: Model");
    parts.push("  Amount: YawAngle (horizontal rotation)");
    parts.push("- Add a second Procedural node for gun elevation:");
    parts.push("  Bone: (gun bone, e.g. v_gun_01)");
    parts.push("  Op: Rotate, Space: Local");
    parts.push("  Amount: AimY");
  }

  parts.push("");
  const seatSectionNum = cfg.hasTurret
    ? 10
    : cfg.dialList.length > 0
      ? 9
      : cfg.hasSteeringLinkage
        ? 8
        : cfg.hasSuspensionIK
          ? 7
          : 6;
  parts.push(`### ${seatSectionNum}. Character Seat State Machine`);
  parts.push("- Add Node -> State Machine, name: SeatStateMachine");
  for (let i = 0; i < cfg.seatTypes.length; i++) {
    const seat = cfg.seatTypes[i];
    const stateName = seat.charAt(0).toUpperCase() + seat.slice(1);
    parts.push(`- Add Node -> State, name: ${stateName}State`);
    parts.push(`  Transition condition: SeatPositionType == ${i}`);
    parts.push("  Each state wraps a Queue for action commands (GetIn, GetOut, Death, etc.)");
  }
  parts.push("- Add IK2Target + IK2 nodes for hand placement on steering wheel / controls:");
  parts.push("  LHandIKTarget -> LeftArm chain");
  parts.push("  RHandIKTarget -> RightArm chain");
  parts.push("  LeftLeg IK target -> LeftLeg chain");
  parts.push("  RightLeg IK target -> RightLeg chain");

  parts.push("");
  parts.push(`### ${seatSectionNum + 1}. Connect the Graph`);
  parts.push("- MasterSleep.Child -> [top of chassis branch]");
  parts.push("- All chassis nodes feed upward to MasterControl");
  parts.push("- Seat state machine runs in parallel via a Blend node if needed");
  parts.push('- DefaultRunNode in AGR must exactly match "MasterControl"');

  return parts.join("\n");
}

function generatePrefabInstructions(cfg: VehicleConfig): string {
  const wheelVars = Array.from({ length: cfg.wheelCount }, (_, i) => `wheel_${i}`).join(", ");
  const suspVars = Array.from({ length: cfg.wheelCount }, (_, i) => `suspension_${i}`).join(", ");

  const parts: string[] = [];
  parts.push("## Prefab Component Setup");
  parts.push("");
  parts.push("Add to your vehicle prefab in World Editor / Prefab Editor:");
  parts.push("");
  parts.push("1. Add component: VehicleAnimationComponent");
  parts.push(
    `   - AnimGraph: {GUID}path/to/${cfg.vehicleName}.agr  (set after Workbench registration)`,
  );
  parts.push(
    `   - AnimInstance: {GUID}path/to/${cfg.vehicleName}.asi  (create .asi after .ast is ready)`,
  );
  parts.push("   - AlwaysActive: 1  (set to 1 if vehicle should animate without an occupant)");
  parts.push("");
  parts.push(
    "2. The .asi file must reference your .ast and map each animation group to .anm files:",
  );
  parts.push("   - Create via Animation Editor -> New Instance");
  parts.push(
    `   - Map each group (${cfg.seatTypes.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(", ")}) and column (Default) to .anm files`,
  );
  parts.push("");
  parts.push("3. VehicleAnimationComponent automatically feeds these variables from physics:");
  parts.push(`   ${wheelVars},`);
  parts.push(`   ${suspVars}, steering, Engine_RPM, SPEED,`);
  parts.push("   VehicleAccelerationFB/LR, YawAngle, Yaw, Pitch, IsDriver, SeatPositionType, etc.");
  parts.push("   You do NOT need script for standard vehicle variables.");

  return parts.join("\n");
}

function generateChecklist(cfg: VehicleConfig): string {
  const parts: string[] = [];
  parts.push("## Verification Checklist");
  parts.push("");
  parts.push("Before verifying, confirm your starting point:");
  parts.push(
    "- [ ] Used Duplicate Project from a base game .aw, OR generated AGR/AST from this tool",
  );
  parts.push("- [ ] All files are registered in Workbench (have real GUIDs, not PLACEHOLDER_GUID)");
  parts.push("");
  parts.push("After setup, verify in Workbench:");
  parts.push("");
  parts.push("1. AGR opens without errors in Animation Editor");
  parts.push("   [ ] Variables list shows all expected variables");
  parts.push("   [ ] IK chains list shows all expected chains");
  parts.push('   [ ] DefaultRunNode = "MasterControl"');
  parts.push("");
  parts.push("2. AGF node graph loads");
  parts.push("   [ ] MasterControl Queue node is present");
  parts.push('   [ ] No "missing node" warnings in editor');
  parts.push("");
  parts.push("3. In-game verification (Workbench Play mode):");
  parts.push("   [ ] Open Animation Editor -> Live Debug tab");
  parts.push("   [ ] Add vehicle to scene, enter play mode");
  parts.push("   [ ] Check variable values update as vehicle moves:");
  parts.push(`     - wheel_0..${cfg.wheelCount - 1} update while driving`);
  if (cfg.hasSuspensionIK) {
    parts.push(`     - suspension_0..${cfg.wheelCount - 1} change over terrain`);
  }
  parts.push("     - steering changes on turn");
  parts.push("   [ ] Visual check: wheels rotate in correct direction");
  if (cfg.hasSuspensionIK) {
    parts.push("   [ ] Visual check: suspension bones move with terrain");
  }
  if (cfg.hasTurret) {
    parts.push("   [ ] Turret rotates with YawAngle variable");
  }
  if (cfg.dialList.length > 0) {
    parts.push("   [ ] Dial bones move with variable changes");
  }
  parts.push("");
  parts.push("4. Seat animations:");
  parts.push("   [ ] GetIn/GetOut animations play on entry/exit");
  parts.push("   [ ] Driver idle/drive animations blend correctly");
  if (cfg.seatTypes.includes("gunner")) {
    parts.push("   [ ] Gunner animations work in turret seat");
  }
  parts.push("");
  parts.push("Common issues:");
  parts.push("- Wheels spin backwards: negate the wheel_N expression (Amount: -wheel_0)");
  if (cfg.hasSuspensionIK) {
    parts.push(
      `- Suspension not moving: check IK chain bone names match v_suspension${0}..${cfg.wheelCount - 1} exactly`,
    );
  }
  parts.push(
    "- Graph not running: verify DefaultRunNode name matches MasterControl Queue node name",
  );
  parts.push(
    "- Variables stuck at 0: ensure VehicleAnimationComponent (not AnimationControllerComponent) is used",
  );

  return parts.join("\n");
}

// ── W4: shared plumbing ──────────────────────────────────────────────────────

export const ANIMATION_GRAPH_ACTIONS = [
  "author",
  "inspect",
  "setup",
  "validate",
  "nodes",
  "edit",
] as const;
export type AnimationGraphAction = (typeof ANIMATION_GRAPH_ACTIONS)[number];

export const ANIMATION_GRAPH_DESCRIPTION =
  "Animation graph files (.agf .agr .ast .asi .aw), offline, lossless. " +
  "inspect (format json pages it), validate (rules that fire on vanilla are warnings), " +
  "nodes (Animation Editor class catalog), edit: .agf addNode removeNode setProp connect disconnect addSheet removeSheet; " +
  ".agr addFile removeFile setDefaultRunNode addVariable removeVariable; project files, dry run unless confirm. author, setup.";

const INSPECT_EXTENSIONS = [".agr", ".agf", ".ast", ".asi", ".aw"];

export interface AnimationGraphArgs {
  action: AnimationGraphAction;
  // 1.x
  vehicleName?: string;
  vehicleType?: "wheeled" | "tracked" | "helicopter" | "boat";
  wheelCount?: number;
  hasTurret?: boolean;
  hasSuspensionIK?: boolean;
  hasShockAbsorbers?: boolean;
  hasSteeringLinkage?: boolean;
  seatTypes?: ("driver" | "gunner" | "commander" | "passenger")[];
  dialList?: string[];
  outputPath?: string;
  modName?: string;
  projectPath?: string;
  path?: string;
  inspectAction?: "inspect" | "validate";
  source?: "mod" | "game";
  agrPath?: string;
  asiPath?: string;
  step?: "all" | "agr" | "agf_instructions" | "prefab_setup" | "checklist";
  agfPath?: string;
  preset?: "character" | "weapon" | "prop" | "custom";
  setupSubAction?: "setup" | "suggest" | "guide";
  // W4
  format?: "text" | "json";
  cursor?: string;
  limit?: number;
  query?: string;
  kind?: CatalogKind | "enum";
  nodeClass?: string;
  op?: GraphOp;
  sheet?: string;
  name?: string | null;
  node?: string;
  prop?: string;
  value?: PropValue | null;
  quoted?: boolean;
  to?: string;
  slot?: string;
  file?: string;
  varType?: (typeof VAR_TYPES)[number];
  min?: number | string;
  max?: number | string;
  defaultValue?: number | string;
  props?: Record<string, PropValue>;
  editorPos?: [number, number];
  raw?: string;
  index?: number;
  confirm?: boolean;
}

export interface ToolText {
  text: string;
  isError: boolean;
}

class Refusal extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly next?: string,
  ) {
    super(message);
    this.name = "Refusal";
  }
}

const MESSAGE_CAP = 400;

function failure(action: string, target: string, e: unknown): ActionResponse {
  if (e instanceof Refusal) return errorResponse(action, target, e.code, e.message, e.next);
  if (e instanceof VocabularyError) return errorResponse(action, target, e.code, e.message);
  if (e instanceof CstEditError) {
    return errorResponse(
      action,
      target,
      e.code === "PATH_NOT_FOUND" ? "PATH_NOT_FOUND" : "INVALID_ARGUMENT",
      e.message,
    );
  }
  const msg = e instanceof Error ? e.message : String(e);
  return errorResponse(action, target, "INVALID_ARGUMENT", msg.slice(0, MESSAGE_CAP));
}

function json(res: ActionResponse): ToolText {
  return { text: JSON.stringify(res, null, 2), isError: !res.ok };
}

function stripRef(raw: string): string {
  return raw
    .trim()
    .replace(/^path:/, "")
    .replace(/^\{[0-9A-Fa-f]{16}\}/, "");
}

function vfsOf(config: Config): PakVirtualFS | null {
  try {
    return config.gamePath ? PakVirtualFS.get(config.gamePath) : null;
  } catch {
    return null;
  }
}

interface Source {
  rel: string;
  where: "project" | "game";
  bytes: Buffer;
}

/** Reads a resource from the project (source mod) or the game data (loose, then paks); null when absent. */
function readSource(
  raw: string,
  source: "mod" | "game",
  projectPath: string | undefined,
  config: Config,
): Source | null {
  const rel = checkRelativePath(stripRef(raw));
  try {
    if (source === "mod") {
      const base = projectPath || config.projectPath;
      if (!base) return null;
      const full = validateProjectPath(base, rel);
      if (!existsSync(full) || !statSync(full).isFile()) return null;
      return { rel, where: "project", bytes: readFileSync(full) };
    }
    const dataPath = join(config.gamePath, "addons", "data");
    const loose = validateProjectPath(dataPath, rel);
    if (existsSync(loose) && statSync(loose).isFile()) {
      return { rel, where: "game", bytes: readFileSync(loose) };
    }
    const vfs = vfsOf(config);
    if (vfs && vfs.exists(rel)) return { rel, where: "game", bytes: vfs.readFile(rel) };
    return null;
  } catch (e) {
    if (e instanceof VocabularyError) throw e;
    return null;
  }
}

/** A reference an .agr holds: the project first, then the game data. */
function readRef(raw: string, a: AnimationGraphArgs, config: Config): Source | null {
  if ((a.source ?? "mod") === "mod") {
    const p = readSource(raw, "mod", a.projectPath, config);
    if (p) return p;
  }
  return readSource(raw, "game", a.projectPath, config);
}

function textOfBytes(b: Buffer): string {
  return parseCstBytes(b).text;
}

function pageOf<T>(
  items: T[],
  a: AnimationGraphArgs,
): { page: T[]; total: number; nextCursor?: string } {
  const limit = Math.min(Math.max(a.limit ?? LIMIT_DEFAULT, 1), LIMIT_MAX);
  let start = 0;
  if (a.cursor) {
    const c = parseCursor(a.cursor);
    checkCursor(c, items.length);
    start = c.start;
  }
  return {
    page: items.slice(start, start + limit),
    total: items.length,
    nextCursor: nextCursor(start, limit, items.length),
  };
}

// ── inspect (json) ───────────────────────────────────────────────────────────

function inspectItems(
  ext: string,
  bytes: Buffer,
): { summary: Record<string, unknown>; items: unknown[] } {
  const doc = parseCstBytes(bytes);
  const text = doc.text;
  if (ext === ".agf") {
    const agf = parseAgfDoc(doc);
    const items = agf.sheets.flatMap((s) =>
      s.nodes.map((n) => ({
        sheet: s.name,
        type: n.type,
        name: n.name,
        children: n.children,
        editorPos: n.editorPos,
        props: n.properties,
      })),
    );
    return {
      summary: {
        sheets: agf.sheets.map((s) => ({ name: s.name, nodes: s.nodes.length })),
        nodes: items.length,
      },
      items,
    };
  }
  if (ext === ".agr") {
    const agr = parseAgrDoc(doc);
    const items = [
      ...agr.variables.map((v) => ({ kind: "variable", ...v })),
      ...agr.commands.map((c) => ({ kind: "command", name: c.name })),
      ...agr.ikChains.map((c) => ({ kind: "ikChain", ...c })),
      ...agr.boneMasks.map((m) => ({ kind: "boneMask", ...m })),
      ...agr.globalTags.map((t) => ({ kind: "tag", name: t })),
      ...agr.agfReferences.map((f) => ({ kind: "file", name: f })),
    ];
    return {
      summary: {
        defaultRunNode: agr.defaultRunNode,
        animSetTemplate: agr.astReference,
        variables: agr.variables.length,
        commands: agr.commands.length,
        ikChains: agr.ikChains.length,
        boneMasks: agr.boneMasks.length,
        tags: agr.globalTags.length,
        files: agr.agfReferences.length,
      },
      items,
    };
  }
  if (ext === ".ast") {
    const ast = parseAstToStruct(text);
    return { summary: { groups: ast.groups.length }, items: ast.groups };
  }
  if (ext === ".asi") {
    const asi = parseAsiToStruct(text);
    return { summary: { mappings: asi.mappings.length }, items: asi.mappings };
  }
  const aw = parseAwToStruct(text);
  return {
    summary: { animGraph: aw.animGraph, animSetTemplate: aw.animSetTemplate },
    items: [
      ...aw.animSetInstances.map((i) => ({ kind: "animSetInstance", ref: i })),
      ...aw.previewModels.map((m) => ({ kind: "previewModel", ref: m })),
      ...aw.childPreviewModels.map((m) => ({ kind: "childPreviewModel", ...m })),
    ],
  };
}

// ── validate ─────────────────────────────────────────────────────────────────

interface FileIssue extends ValidationIssue {
  file: string;
}

interface ValidateOutcome {
  files: { path: string; errors: number; warnings: number }[];
  issues: FileIssue[];
  errorCount: number;
  warningCount: number;
  missing: string[];
}

function runValidate(
  a: AnimationGraphArgs,
  config: Config,
  main: Source,
  ext: string,
): ValidateOutcome {
  const out: ValidateOutcome = {
    files: [],
    issues: [],
    errorCount: 0,
    warningCount: 0,
    missing: [],
  };
  const source = a.source ?? "mod";
  const record = (path: string, issues: ValidationIssue[]) => {
    const errors = issues.filter((i) => i.severity === "error").length;
    out.files.push({ path, errors, warnings: issues.length - errors });
    out.errorCount += errors;
    out.warningCount += issues.length - errors;
    for (const i of issues) out.issues.push({ file: path, ...i });
  };
  let asi: ParsedAsi | undefined;
  if (a.asiPath) {
    const s = readSource(a.asiPath, source, a.projectPath, config);
    if (s) asi = parseAsiToStruct(textOfBytes(s.bytes));
    else out.missing.push(a.asiPath);
  }
  if (ext === ".agf") {
    const agf = parseAgfToStruct(textOfBytes(main.bytes));
    let agr: ParsedAgr | undefined;
    let agrContent: string | undefined;
    const names: string[] = [];
    if (a.agrPath) {
      const s = readSource(a.agrPath, source, a.projectPath, config);
      if (s) {
        agrContent = textOfBytes(s.bytes);
        agr = parseAgrToStruct(agrContent);
        for (const ref of agr.agfReferences) {
          if (stripRef(ref).toLowerCase() === main.rel.toLowerCase()) continue;
          const o = readRef(ref, a, config);
          if (o)
            for (const sh of parseAgfToStruct(textOfBytes(o.bytes)).sheets)
              for (const n of sh.nodes) names.push(n.name);
        }
      } else out.missing.push(a.agrPath);
    }
    const r = validateGraph(agf, agr, asi, main.rel, { agrContent, graphNodeNames: names });
    record(main.rel, r.issues);
    return out;
  }
  // .agr: every .agf it lists, each with the others' node names for V06.
  const agrContent = textOfBytes(main.bytes);
  const agr = parseAgrToStruct(agrContent);
  const agfs: { rel: string; agf: ParsedAgf }[] = [];
  for (const ref of agr.agfReferences) {
    let s: Source | null = null;
    try {
      s = readRef(ref, a, config);
    } catch {
      s = null;
    }
    if (s) agfs.push({ rel: s.rel, agf: parseAgfToStruct(textOfBytes(s.bytes)) });
    else out.missing.push(stripRef(ref));
  }
  if (agfs.length === 0) {
    record(
      main.rel,
      validateGraph({ sheets: [] }, agr, asi, undefined, { agrContent }).issues.filter(
        (i) => i.id !== "V06",
      ),
    );
  }
  for (const f of agfs) {
    const others = agfs
      .filter((x) => x !== f)
      .flatMap((x) => x.agf.sheets.flatMap((s) => s.nodes.map((n) => n.name)));
    record(
      f.rel,
      validateGraph(f.agf, agr, asi, f.rel, { agrContent, graphNodeNames: others }).issues,
    );
  }
  return out;
}

function needInspectable(a: AnimationGraphArgs, exts: string[]): { rel: string; ext: string } {
  if (!a.path) throw new Refusal("INVALID_ARGUMENT", `path is required for ${a.action}`);
  const rel = checkRelativePath(stripRef(a.path));
  const ext = extname(rel).toLowerCase();
  if (!exts.includes(ext)) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `${a.action} takes ${exts.join(" ")}, got ${ext || "no extension"}`,
    );
  }
  return { rel, ext };
}

function mustRead(a: AnimationGraphArgs, config: Config, rel: string): Source {
  const source = a.source ?? "mod";
  if (source === "mod" && !(a.projectPath || config.projectPath)) {
    throw new Refusal(
      "NOT_IN_PROJECT",
      "no project root: set ENFUSION_PROJECT_PATH or pass projectPath",
    );
  }
  const s = readSource(rel, source, a.projectPath, config);
  if (!s) {
    throw new Refusal(
      "PATH_NOT_FOUND",
      `no file "${rel}" in the ${source === "mod" ? "project" : "game data"}`,
      source === "mod"
        ? "A game file is read with source:game."
        : "Check the path with game_browse.",
    );
  }
  return s;
}

function doValidate(a: AnimationGraphArgs, config: Config): ActionResponse {
  const { rel, ext } = needInspectable(a, [".agf", ".agr"]);
  const main = mustRead(a, config, rel);
  const v = runValidate(a, config, main, ext);
  const { page, total, nextCursor: nc } = pageOf(v.issues, a);
  const warnings = v.missing.map((m) => `not found, not validated: ${m}`);
  return {
    ok: true,
    action: "validate",
    target: `path:${rel}`,
    changed: null,
    readback: {
      source: main.where,
      files: v.files,
      errorCount: v.errorCount,
      warningCount: v.warningCount,
      issues: page,
      total,
      ...(nc ? { nextCursor: nc } : {}),
    },
    next:
      v.errorCount === 0
        ? "No error. Warnings marked demoted fire on shipping vanilla graphs too (DEC-067 OD-4)."
        : "Fix the errors; edit changes .agf/.agr files in the project.",
    warnings,
  };
}

// ── nodes ────────────────────────────────────────────────────────────────────

function doNodes(a: AnimationGraphArgs): ActionResponse {
  const target = `catalog:${NODE_CATALOG_BUILD}`;
  if (a.nodeClass) {
    const c = catalogClass(a.nodeClass);
    if (!c) {
      const near = [...catalog().keys()]
        .filter((k) =>
          k.toLowerCase().includes(a.nodeClass!.toLowerCase().replace(/^animsrcnode/, "")),
        )
        .slice(0, 10);
      throw new Refusal(
        "ITEM_NOT_FOUND",
        `no class ${a.nodeClass} in the ${NODE_CATALOG_BUILD} catalog${near.length ? ` (close: ${near.join(", ")})` : ""}`,
        "List the classes with nodes and a query.",
      );
    }
    return {
      ok: true,
      action: "nodes",
      target,
      changed: null,
      readback: { build: NODE_CATALOG_BUILD, class: c },
      next: "edit addNode takes this class; setProp takes these keys.",
      warnings: [],
    };
  }
  const q = a.query?.toLowerCase();
  if (a.kind === "enum") {
    const items = catalogEnums().filter(
      (e) => !q || e.class.toLowerCase().includes(q) || e.key.toLowerCase().includes(q),
    );
    const { page, total, nextCursor: nc } = pageOf(items, a);
    return {
      ok: true,
      action: "nodes",
      target,
      changed: null,
      readback: {
        build: NODE_CATALOG_BUILD,
        kind: "enum",
        items: page,
        total,
        ...(nc ? { nextCursor: nc } : {}),
      },
      warnings: [],
    };
  }
  const items = [...catalog().values()]
    .filter((c) => (!a.kind || c.kind === a.kind) && (!q || c.name.toLowerCase().includes(q)))
    .map((c) => ({
      name: c.name,
      kind: c.kind,
      ext: c.ext,
      instances: c.instances,
      files: c.files,
      keys: c.keys.map((k) => k.name),
    }));
  const { page, total, nextCursor: nc } = pageOf(items, a);
  return {
    ok: true,
    action: "nodes",
    target,
    changed: null,
    readback: { build: NODE_CATALOG_BUILD, items: page, total, ...(nc ? { nextCursor: nc } : {}) },
    next: "nodeClass:<name> gives one class with its key signatures and enum values.",
    warnings: [],
  };
}

// ── edit ─────────────────────────────────────────────────────────────────────

function eachOpaque(entries: readonly CstEntry[], visit: (e: CstEntry) => void): void {
  for (const e of entries) {
    if (e.kind === "opaque") visit(e);
    else if (e.kind === "object") eachOpaque(e.children, visit);
  }
}

/** Why the writer will not touch this file, or undefined when it can. */
function unwritableReason(doc: CstDocument, bytes: Buffer): string | undefined {
  if (!doc.toBytes().equals(bytes)) return "the parser does not give the file back byte for byte";
  if (doc.diagnostics.length > 0) {
    const d = doc.diagnostics[0];
    return `the file has ${doc.diagnostics.length} parse diagnostic(s), the first at line ${d.line}: ${d.message}`;
  }
  let opaque = 0;
  eachOpaque(doc.root.children, () => opaque++);
  if (opaque > 0) return `the file has ${opaque} entr(ies) the writer cannot address`;
  return undefined;
}

function opOf(a: AnimationGraphArgs): GraphEditOp {
  if (!a.op) throw new Refusal("INVALID_ARGUMENT", `edit needs op: ${GRAPH_OPS.join(", ")}`);
  const o: GraphEditOp = { op: a.op };
  const keys = [
    "sheet",
    "name",
    "nodeClass",
    "props",
    "editorPos",
    "node",
    "prop",
    "value",
    "quoted",
    "to",
    "slot",
    "file",
    "varType",
    "min",
    "max",
    "defaultValue",
    "raw",
    "index",
  ] as const;
  for (const k of keys) {
    if (a[k] !== undefined) (o as unknown as Record<string, unknown>)[k] = a[k];
  }
  return o;
}

/** Warnings about references the edit makes that this tool can check offline. */
function referenceWarnings(
  a: AnimationGraphArgs,
  op: GraphEditOp,
  doc: CstDocument,
  config: Config,
): string[] {
  const out: string[] = [];
  if (
    op.op === "setDefaultRunNode" &&
    typeof op.name === "string" &&
    op.name !== "" &&
    op.raw === undefined
  ) {
    const agr = parseAgrDoc(doc);
    const names = new Set<string>();
    let read = 0;
    for (const ref of agr.agfReferences) {
      const s = readRef(ref, a, config);
      if (!s) continue;
      read++;
      for (const sh of parseAgfToStruct(textOfBytes(s.bytes)).sheets)
        for (const n of sh.nodes) names.add(n.name);
    }
    if (read > 0 && !names.has(op.name)) {
      out.push(`no node '${op.name}' in the ${read} .agf file(s) of the graph read`);
    }
  }
  if (op.op === "addFile" && op.file && op.raw === undefined) {
    if (!readRef(op.file, a, config))
      out.push(`${stripRef(op.file)} is not in the project or the game data`);
  }
  return out;
}

function doEdit(a: AnimationGraphArgs, config: Config): ActionResponse {
  const op = opOf(a);
  const want = opExtension(op.op);
  const { rel, ext } = needInspectable(a, [".agf", ".agr"]);
  if (ext !== want)
    throw new Refusal("INVALID_ARGUMENT", `op ${op.op} edits a ${want} file, got ${ext}`);
  const root = a.projectPath || config.projectPath;
  if (!root)
    throw new Refusal(
      "NOT_IN_PROJECT",
      "no project root: set ENFUSION_PROJECT_PATH or pass projectPath",
    );
  const abs = resolve(root, rel);
  try {
    assertInsideRoot(abs, root, "path");
  } catch (e) {
    throw new Refusal("NOT_IN_PROJECT", e instanceof Error ? e.message : String(e));
  }
  if (!existsSync(abs)) {
    if (readSource(rel, "game", a.projectPath, config)) {
      throw new Refusal(
        "NOT_IN_PROJECT",
        `${rel} is a game resource: read only; edit changes files inside the project`,
        "Copy it into the project first (game_duplicate), then edit the copy.",
      );
    }
    throw new Refusal("PATH_NOT_FOUND", `no file "${rel}" in the project`);
  }
  if (!statSync(abs).isFile()) throw new Refusal("INVALID_ARGUMENT", `${rel} is not a file`);
  const bytes = readFileSync(abs);
  const doc = parseCstBytes(bytes);
  const why = unwritableReason(doc, bytes);
  if (why) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `${rel} is refused, not rewritten: ${why}`,
      "Edit it in the Animation Editor, or fix the text by hand and retry.",
    );
  }
  const plan = applyGraphEdit(doc, op);
  const warnings = [...plan.warnings, ...referenceWarnings(a, op, doc, config)];
  const newBytes = plan.doc.toBytes();
  const target = `path:${rel}`;
  const confirm = a.confirm === true;
  const readback: Record<string, unknown> = {
    op: op.op,
    dryRun: !confirm,
    diff: lineDiff(doc.text, plan.doc.text),
    bytesBefore: bytes.length,
    bytesAfter: newBytes.length,
    inverse: plan.inverse,
  };
  const base = { ok: true as const, action: "edit", target, changed: plan.changed, readback };
  if (!confirm) {
    return {
      ...base,
      next: "Nothing was written. Repeat the call with confirm:true to write exactly this change.",
      warnings,
    };
  }
  if (newBytes.equals(bytes)) {
    readback.written = false;
    return { ...base, next: "The file already had this content: nothing written.", warnings };
  }
  if (!readFileSync(abs).equals(bytes)) {
    throw new Refusal(
      "INVALID_ARGUMENT",
      `${rel} changed on disk while the edit was planned: nothing written`,
      "Read it again and repeat the call.",
    );
  }
  // A numbered backup: an earlier .bak (the first original bytes) is kept (review round 1, W4-AS-1).
  const backup = backUp(abs, (m) => {
    throw new Refusal("INVALID_ARGUMENT", m);
  });
  writeFileAtomic(abs, newBytes);
  const verified = readFileSync(abs).equals(newBytes);
  readback.written = true;
  readback.verified = verified;
  readback.backup = backupRel(rel, abs, backup);
  return {
    ...base,
    next:
      `Written; the old file is beside it as ${readback.backup}. An Animation Editor` +
      " tab that has this file open keeps its own copy: reopen it there. " +
      "readback.inverse undoes the edit.",
    warnings: verified
      ? warnings
      : [...warnings, "the file read back differs from what was written"],
  };
}

// ── 1.x actions ──────────────────────────────────────────────────────────────

function vehicleConfig(a: AnimationGraphArgs): VehicleConfig {
  return {
    vehicleName: a.vehicleName ?? "",
    vehicleType: a.vehicleType ?? "wheeled",
    wheelCount: a.wheelCount ?? 4,
    hasTurret: a.hasTurret ?? false,
    hasSuspensionIK: a.hasSuspensionIK ?? true,
    hasShockAbsorbers: a.hasShockAbsorbers ?? false,
    hasSteeringLinkage: a.hasSteeringLinkage ?? false,
    seatTypes: a.seatTypes ?? ["driver"],
    dialList: a.dialList ?? [],
  };
}

function doAuthor(a: AnimationGraphArgs, config: Config): ToolText {
  const basePath = a.projectPath || config.projectPath;
  if (!basePath) return { text: "No project path configured.", isError: true };
  if (!a.vehicleName) return { text: "author action requires vehicleName.", isError: true };
  const cfg = vehicleConfig(a);
  try {
    const agrContent = generateAgrAuthor(cfg);
    const astContent = generateAstAuthor(cfg);
    const agrPath = validateProjectPath(basePath, `${a.outputPath}/${a.vehicleName}.agr`);
    const astPath = validateProjectPath(basePath, `${a.outputPath}/${a.vehicleName}.ast`);
    mkdirSync(dirname(agrPath), { recursive: true });
    writeFileAtomic(agrPath, agrContent);
    writeFileAtomic(astPath, astContent);
    return {
      text: [
        `Generated animation graph files for ${a.vehicleName}:`,
        `  AGR: ${a.outputPath}/${a.vehicleName}.agr`,
        `  AST: ${a.outputPath}/${a.vehicleName}.ast`,
        "",
        "Next steps:",
        "1. Open Workbench and register both files (right-click -> Add to project)",
        "2. Open the AGR in Animation Editor to verify variables and IK chains",
        "3. Create a new .agf file and build the node graph (use action=setup for guided instructions)",
        "4. Create a .asi file mapping AST animation groups to .anm files",
        "5. Add VehicleAnimationComponent to your vehicle prefab, set AnimGraph + AnimInstance",
      ].join("\n"),
      isError: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { text: `Error generating animation graph files: ${msg}`, isError: true };
  }
}

function doInspect(a: AnimationGraphArgs, config: Config): ToolText {
  if (!a.path) return { text: "path is required for inspect action.", isError: true };
  const ext = extname(a.path).toLowerCase();
  if (!INSPECT_EXTENSIONS.includes(ext)) {
    return {
      text: `Unsupported file type: ${ext}. Supported: ${INSPECT_EXTENSIONS.join(", ")}`,
      isError: true,
    };
  }
  if (a.inspectAction === "validate") {
    // 1.x alias of validate: the same rules, the 1.x text report.
    if (ext !== ".agf" && ext !== ".agr") {
      return {
        text: "Validate action requires an .agf (or .agr) file as the primary path.",
        isError: true,
      };
    }
    let main: Source;
    try {
      main = mustRead(a, config, checkRelativePath(stripRef(a.path)));
    } catch (e) {
      return { text: e instanceof Error ? e.message : String(e), isError: true };
    }
    const v = runValidate(a, config, main, ext);
    const report = formatValidationReport(v.issues, v.errorCount, v.warningCount);
    const missing = v.missing.length ? `\n\nNot found, not validated: ${v.missing.join(", ")}` : "";
    return { text: report + missing, isError: false };
  }
  let main: Source;
  try {
    main = mustRead(a, config, checkRelativePath(stripRef(a.path)));
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e), isError: true };
  }
  if (a.format === "json") {
    const { summary, items } = inspectItems(ext, main.bytes);
    const res: ActionResponse = (() => {
      try {
        const { page, total, nextCursor: nc } = pageOf(items, a);
        return {
          ok: true,
          action: "inspect",
          target: `path:${main.rel}`,
          changed: null,
          readback: {
            source: main.where,
            ...summary,
            items: page,
            total,
            ...(nc ? { nextCursor: nc } : {}),
          },
          warnings: [],
        };
      } catch (e) {
        return failure("inspect", `path:${main.rel}`, e);
      }
    })();
    return json(res);
  }
  const content = textOfBytes(main.bytes);
  let summary: string;
  if (ext === ".agr") summary = formatAgrSummary(parseAgrToStruct(content));
  else if (ext === ".agf") summary = formatAgfTree(parseAgfToStruct(content));
  else if (ext === ".ast") summary = formatAstSummary(parseAstToStruct(content));
  else if (ext === ".asi") summary = formatAsiSummary(parseAsiToStruct(content));
  else summary = formatAwSummary(parseAwToStruct(content));
  return { text: summary, isError: false };
}

function readOptional(raw: string, a: AnimationGraphArgs, config: Config): string | null {
  try {
    const s = readSource(raw, a.source ?? "mod", a.projectPath, config);
    return s ? textOfBytes(s.bytes) : null;
  } catch {
    return null;
  }
}

function doSetup(a: AnimationGraphArgs, config: Config): ToolText {
  const sub = a.setupSubAction ?? "setup";
  if (sub === "guide") return { text: generateGuide(a.preset ?? "custom"), isError: false };
  if (sub === "suggest") {
    if (!a.agfPath) return { text: "agfPath is required for suggest sub-action.", isError: true };
    const agfContent = readOptional(a.agfPath, a, config);
    if (!agfContent) return { text: `Could not read AGF file: ${a.agfPath}`, isError: true };
    const agf = parseAgfToStruct(agfContent);
    let agr;
    if (a.agrPath) {
      const agrContent = readOptional(a.agrPath, a, config);
      if (agrContent) agr = parseAgrToStruct(agrContent);
    }
    return { text: formatSuggestions(generateSuggestions(agf, agr)), isError: false };
  }
  if (!a.vehicleName) return { text: "vehicleName is required for setup action.", isError: true };
  const cfg = vehicleConfig(a);
  const step = a.step ?? "all";
  const parts: string[] = [];
  if (step === "all" || step === "agr") {
    const basePath = a.projectPath || config.projectPath;
    if (basePath) {
      try {
        const agrContent = generateAgrAuthor(cfg);
        const astContent = generateAstAuthor(cfg);
        const agrFilePath = validateProjectPath(basePath, `${a.outputPath}/${a.vehicleName}.agr`);
        const astFilePath = validateProjectPath(basePath, `${a.outputPath}/${a.vehicleName}.ast`);
        mkdirSync(dirname(agrFilePath), { recursive: true });
        writeFileAtomic(agrFilePath, agrContent);
        writeFileAtomic(astFilePath, astContent);
        parts.push(
          `## Step 1: AGR + AST Files Generated\n- ${a.outputPath}/${a.vehicleName}.agr\n- ${a.outputPath}/${a.vehicleName}.ast\nRegister both files in Workbench to assign GUIDs.`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        parts.push(`## Step 1: AGR + AST — Error\n${msg}`);
      }
    } else {
      parts.push(
        "## Step 1: AGR + AST — Skipped\nNo project path configured. Set ENFUSION_PROJECT_PATH or provide projectPath.",
      );
    }
  }
  if (step === "all" || step === "agf_instructions") parts.push(generateAgfInstructions(cfg));
  if (step === "all" || step === "prefab_setup") parts.push(generatePrefabInstructions(cfg));
  if (step === "all" || step === "checklist") parts.push(generateChecklist(cfg));
  return { text: parts.join("\n\n---\n\n"), isError: false };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/** One call of the tool; never throws. */
export function runAnimationGraph(a: AnimationGraphArgs, config: Config): ToolText {
  // Every action below reads or writes under a.projectPath, so it is pinned once here.
  try {
    pinnedProjectRoot(a.projectPath, config.projectPath);
  } catch (e) {
    if (a.action === "author" || a.action === "inspect" || a.action === "setup")
      return { text: `Error: ${(e as Error).message}`, isError: true };
    return json(failure(a.action, `path:${stripRef(a.path ?? "")}`, e));
  }
  switch (a.action) {
    case "author":
      return doAuthor(a, config);
    case "inspect":
      return doInspect(a, config);
    case "setup":
      return doSetup(a, config);
    default:
      break;
  }
  const target =
    a.action === "nodes" ? `catalog:${NODE_CATALOG_BUILD}` : `path:${stripRef(a.path ?? "")}`;
  try {
    if (a.action === "validate") return json(doValidate(a, config));
    if (a.action === "nodes") return json(doNodes(a));
    if (a.action === "edit") return json(doEdit(a, config));
    throw new Refusal("INVALID_ARGUMENT", `unknown action ${String(a.action)}`);
  } catch (e) {
    return json(failure(a.action, target, e));
  }
}

const SCALAR = z.union([z.string(), z.number(), z.boolean()]);
const VALUE = z.union([SCALAR, z.array(SCALAR).min(1)]);

export function registerAnimationGraph(server: McpServer, config: Config): void {
  server.registerTool(
    "animation_graph",
    {
      description: ANIMATION_GRAPH_DESCRIPTION,
      inputSchema: {
        action: z.enum(ANIMATION_GRAPH_ACTIONS),

        // ── author / setup (1.x) ──
        vehicleName: z
          .string()
          .optional()
          .describe("(author/setup) Vehicle name, used in file names and GlobalTags."),
        vehicleType: z
          .enum(["wheeled", "tracked", "helicopter", "boat"])
          .default("wheeled")
          .describe("(author/setup) Vehicle type."),
        wheelCount: z
          .number()
          .int()
          .min(2)
          .max(8)
          .refine((n) => n % 2 === 0, "Must be even (2/4/6/8)")
          .default(4)
          .describe("(author/setup) Wheels (2/4/6/8)."),
        hasTurret: z
          .boolean()
          .default(false)
          .describe("(author/setup) Turret variables and bone mask."),
        hasSuspensionIK: z.boolean().default(true).describe("(author/setup) Suspension IK chains."),
        hasShockAbsorbers: z
          .boolean()
          .default(false)
          .describe("(author/setup) Shock absorber IK chains."),
        hasSteeringLinkage: z
          .boolean()
          .default(false)
          .describe("(author/setup) Steering axis IK chains."),
        seatTypes: z
          .array(z.enum(["driver", "gunner", "commander", "passenger"]))
          .default(["driver"])
          .describe("(author/setup) Seat types."),
        dialList: z
          .array(z.string())
          .default([])
          .describe("(author/setup) Variables used as dials."),
        outputPath: z
          .string()
          .optional()
          .describe("(author/setup) Destination folder in the project."),
        modName: z.string().optional().describe("(author/setup) Addon folder name."),
        projectPath: z
          .string()
          .optional()
          .describe("Project root. Uses the configured project when omitted."),

        // ── inspect / validate ──
        path: z
          .string()
          .optional()
          .describe(
            "The file (.agr .agf .ast .asi .aw), project-relative (source mod) or game-relative (source game).",
          ),
        inspectAction: z
          .enum(["inspect", "validate"])
          .default("inspect")
          .describe("(inspect) validate = the validate action, 1.x text report."),
        source: z
          .enum(["mod", "game"])
          .default("mod")
          .describe("Read from the project (mod) or the game data (game)."),
        agrPath: z
          .string()
          .optional()
          .describe("(validate, setup suggest) The .agr for cross-checks."),
        asiPath: z.string().optional().describe("(validate) The .asi for mapping checks."),
        format: z
          .enum(["text", "json"])
          .optional()
          .describe("(inspect) json: paged items instead of the text summary."),
        cursor: z
          .string()
          .optional()
          .describe("(inspect json, validate, nodes) <start>:<count> from nextCursor."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIMIT_MAX)
          .optional()
          .describe("Page size (default 100)."),

        // ── setup (1.x) ──
        step: z
          .enum(["all", "agr", "agf_instructions", "prefab_setup", "checklist"])
          .default("all")
          .describe("(setup) Section to return."),
        agfPath: z.string().optional().describe("(setup suggest) The .agf to analyse."),
        preset: z
          .enum(["character", "weapon", "prop", "custom"])
          .optional()
          .describe("(setup guide) Preset."),
        setupSubAction: z
          .enum(["setup", "suggest", "guide"])
          .default("setup")
          .describe("(setup) Sub-action."),

        // ── nodes ──
        query: z.string().optional().describe("(nodes) Substring of the class (or enum key) name."),
        kind: z
          .enum(["node", "item", "event", "graph", "file", "legacy", "other", "enum"])
          .optional()
          .describe("(nodes) Class kind; enum lists the enum-like keys with their values."),
        nodeClass: z
          .string()
          .optional()
          .describe("(nodes) One class with its keys. (edit addNode) The class."),

        // ── edit ──
        op: z.enum(GRAPH_OPS).optional().describe("(edit) The op."),
        sheet: z.string().optional().describe("(edit .agf) The sheet; optional when unambiguous."),
        name: z
          .string()
          .nullable()
          .optional()
          .describe(
            "(edit) Node, sheet or variable name; setDefaultRunNode: the node (null removes).",
          ),
        node: z.string().optional().describe("(edit setProp/connect/disconnect) The node."),
        prop: z
          .string()
          .optional()
          .describe("(edit setProp) Path in the node: Child, BlendWeight, QueueItems[0].Child."),
        value: VALUE.nullable()
          .optional()
          .describe("(edit setProp) The value; a list writes several; null removes."),
        quoted: z.boolean().optional().describe("(edit setProp/connect) Force quotes on or off."),
        to: z.string().optional().describe("(edit connect) The child node."),
        slot: z
          .string()
          .optional()
          .describe("(edit connect/disconnect) Slot path (default Child)."),
        file: z.string().optional().describe("(edit addFile/removeFile) {GUID}path.agf."),
        varType: z
          .enum(VAR_TYPES)
          .optional()
          .describe("(edit addVariable) Float (default), Int, Bool, String."),
        min: z.union([z.number(), z.string()]).optional().describe("(edit addVariable) MinValue."),
        max: z.union([z.number(), z.string()]).optional().describe("(edit addVariable) MaxValue."),
        defaultValue: z
          .union([z.number(), z.string()])
          .optional()
          .describe("(edit addVariable) DefaultValue."),
        props: z
          .record(z.string(), VALUE)
          .optional()
          .describe("(edit addNode) {key: value} of the new node."),
        editorPos: z
          .tuple([z.number(), z.number()])
          .optional()
          .describe("(edit addNode) EditorPos x y."),
        raw: z
          .string()
          .optional()
          .describe("(edit) Exact lines to restore, as readback.inverse gives them."),
        index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("(edit) Position in the block (default end)."),
        confirm: z.boolean().optional().describe("(edit) true writes; otherwise a dry run."),
      },
    },
    async (args) => {
      const r = runAnimationGraph(args as AnimationGraphArgs, config);
      return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
    },
  );
}
