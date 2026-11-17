/**
 * Catalog of the Animation Editor's classes (wave W4, phase5-w4-spec.md 2.4):
 * every class and key the AnimEditor files of the 1.9.0.37 paks use, with the
 * literal values seen for the enum-like keys. `animation_graph nodes` reads it;
 * `animation_graph edit` checks node classes and keys against it.
 *
 * Source: the E10 schema census of build 1.9.0.37
 * (data/census/observations/E10/1.9.0.37.jsonl, rows of module AnimEditor:
 * 106 classes, 421 keys), generated, not hand-written. A class the vanilla
 * files never use is not in the index, so it is not here either.
 */

export const NODE_CATALOG_BUILD = "1.9.0.37";

/** [class, extension(s), instances, files, keys: [name, signature, literal values?][]] */
type Row = [string, string, number, number, [string, string, string[]?][]];

const ROWS: Row[] = [
  ["$AnimGraph", "agr", 1, 1, []],
  ["$EditorData", "agr", 23, 1, []],
  ["$Node", "agr", 13, 1, []],
  ["$Predictions", "agr", 8, 1, []],
  ["$Sheet", "agr", 1, 1, []],
  ["$State", "agr", 10, 1, []],
  ["$States", "agr", 1, 1, []],
  ["$Transition", "agr", 22, 1, []],
  ["$Transitions", "agr", 1, 1, []],
  ["$eventtable", "ae", 1, 1, []],
  ["AnimEventTable", "ae", 1, 1, [["EventNames", "array of quoted strings"]]],
  [
    "AnimSetInstanceSource",
    "asi",
    248,
    248,
    [
      ["IkPose", "resource ref"],
      ["Lines", "array of blocks"],
      ["ParentTemplates", "array of resource refs"],
      ["RBF", "block"],
      ["Template", "resource ref"],
    ],
  ],
  ["AnimSetInstanceSourceRBFArray", "asi", 239, 239, []],
  ["AnimSetInstanceSource_Line", "asi", 17196, 229, [["Resource", "resource ref"]]],
  ["AnimSetTemplateSource", "ast", 131, 131, [["Groups", "array of blocks"]]],
  [
    "AnimSetTemplateSource_AnimationGroup",
    "ast",
    302,
    127,
    [
      ["Animations", "array of quoted strings"],
      ["Columns", "array of quoted strings"],
      ["Name", "quoted string"],
    ],
  ],
  [
    "AnimSrcConstraintParent",
    "agf",
    75,
    2,
    [
      ["AffectedBone", "quoted string"],
      ["TargetBone", "quoted string"],
    ],
  ],
  [
    "AnimSrcDebugCtlCmd",
    "agr",
    14,
    2,
    [
      ["Binding", "quoted string"],
      ["FloatVal", "number"],
      ["IntVal", "number"],
    ],
  ],
  ["AnimSrcDebugCtlGroup", "agr", 16, 2, [["DebugControls", "array of blocks"]]],
  [
    "AnimSrcDebugCtlVar",
    "agr",
    46,
    2,
    [
      ["Binding", "quoted string"],
      ["BoolVal", "number"],
      ["FloatVal", "number"],
      ["IntVal", "number"],
    ],
  ],
  [
    "AnimSrcEvent",
    "agf",
    29,
    13,
    [
      ["Condition", "quoted string"],
      ["InitOnly", "number"],
      ["Name", "quoted string"],
      ["Once", "number"],
      ["UserInt", "number"],
      ["UserString", "quoted string"],
    ],
  ],
  [
    "AnimSrcEventGeneric",
    "agf",
    735,
    62,
    [
      ["Condition", "quoted string"],
      ["InitOnly", "number"],
      ["MainPathOnly", "number"],
      ["Name", "quoted string"],
      ["Once", "number"],
      ["UserInt", "number"],
      ["UserString", "quoted string"],
    ],
  ],
  [
    "AnimSrcGCT",
    "agr",
    132,
    132,
    [
      ["BoneMasks", "array of blocks"],
      ["Commands", "array of blocks"],
      ["CurveLibraries", "array of blocks"],
      ["GlobalTags", "array of quoted strings"],
      ["IkChains", "array of blocks"],
      ["Variables", "array of blocks"],
    ],
  ],
  ["AnimSrcGCTBoneMask", "agr", 88, 30, [["Bones", "array of quoted strings"]]],
  ["AnimSrcGCTCmd", "agr", 739, 114, [["Synchronized", "number"]]],
  ["AnimSrcGCTCurve", "agr", 3, 1, [["Curve", "block"]]],
  ["AnimSrcGCTCurveLib", "agr", 1, 1, [["Curves", "array of blocks"]]],
  [
    "AnimSrcGCTIkChain",
    "agr",
    809,
    98,
    [
      ["ChainAxis", "quoted string"],
      ["IsHierarchy", "number"],
      ["Joints", "array of quoted strings"],
      ["MiddleJoint", "quoted string"],
    ],
  ],
  [
    "AnimSrcGCTVarBool",
    "agr",
    406,
    96,
    [
      ["DefaultValue", "number"],
      ["Synchronized", "number"],
    ],
  ],
  [
    "AnimSrcGCTVarFloat",
    "agr",
    1320,
    123,
    [
      ["DefaultValue", "number"],
      ["MaxValue", "number"],
      ["MinValue", "number"],
      ["Synchronized", "number"],
    ],
  ],
  [
    "AnimSrcGCTVarInt",
    "agr",
    319,
    117,
    [
      ["DefaultValue", "number"],
      ["MaxValue", "number"],
      ["MinValue", "number"],
      ["Synchronized", "number"],
    ],
  ],
  ["AnimSrcGCTVarString", "agr", 2, 2, []],
  ["AnimSrcGD", "agr", 132, 132, [["DebugControlGroups", "array of blocks"]]],
  [
    "AnimSrcGraph",
    "agr",
    132,
    132,
    [
      ["AnimExpressionTable", "resource ref"],
      ["AnimSetTemplate", "resource ref"],
      ["AnimSyncTable", "resource ref"],
      ["ControlTemplate", "block"],
      ["Debug", "block"],
      ["DefaultRunNode", "quoted string"],
      ["GraphFilesResourceNames", "array of resource refs"],
    ],
  ],
  ["AnimSrcGraphFile", "agf", 154, 154, [["Sheets", "array of blocks"]]],
  ["AnimSrcGraphNodeGroup", "agf", 253, 26, [["EditorColor", "numbers[4]"]]],
  [
    "AnimSrcGraphSheet",
    "agf",
    266,
    153,
    [
      ["NodeGroups", "array of blocks"],
      ["Nodes", "array of blocks"],
    ],
  ],
  [
    "AnimSrcIkBinding",
    "agf",
    1318,
    96,
    [
      ["IkChain", "quoted string"],
      ["IkTarget", "quoted string"],
    ],
  ],
  [
    "AnimSrcIkTargetBinding",
    "agf",
    761,
    84,
    [
      ["IkChain", "quoted string"],
      ["IkTarget", "quoted string"],
      ["LocalSpaceOffset", "block"],
    ],
  ],
  ["AnimSrcJiggleConstraintLinear", "agf", 1, 1, [["BoundBone", "quoted string"]]],
  [
    "AnimSrcNodeAttachment",
    "agf",
    10,
    3,
    [
      ["Binding", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["Tags", "array of quoted strings | empty array"],
    ],
  ],
  [
    "AnimSrcNodeBindPose",
    "agf",
    101,
    33,
    [
      ["BoneMask", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["NodeGroup", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeBlend",
    "agf",
    1210,
    125,
    [
      ["BlendFn", "bare word | quoted string", ["S"]],
      ["BlendWeight", "quoted string"],
      ["Child0", "quoted string"],
      ["Child1", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["IkTargets", "quoted string"],
      ["MotionVectors", "bare word", ["First", "Second"]],
      ["NodeGroup", "quoted string"],
      ["Optimization", "quoted string"],
      ["OptimizeMax", "number"],
      ["OptimizeMin", "number"],
      ["SelectMainPath", "number"],
      ["Tags", "array of quoted strings | empty array"],
    ],
  ],
  [
    "AnimSrcNodeBlendN",
    "agf",
    79,
    22,
    [
      ["BlendFn", "quoted string"],
      ["BlendWeight", "quoted string"],
      ["Children", "array of quoted strings"],
      ["EditorPos", "numbers[2]"],
      ["IsCyclic", "number"],
      ["NodeGroup", "quoted string"],
      ["SelectMainPath", "number"],
      ["Tags", "array of quoted strings"],
      ["Thresholds", "array of numbers"],
    ],
  ],
  [
    "AnimSrcNodeBlendT",
    "agf",
    349,
    87,
    [
      ["BlendFn", "bare word | quoted string"],
      ["BlendTime", "quoted string"],
      ["Child0", "quoted string"],
      ["Child1", "quoted string"],
      ["Condition", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["IkTargets", "quoted string"],
      ["NodeGroup", "quoted string"],
      ["Optimization", "quoted string"],
      ["OptimizeMax", "number"],
      ["OptimizeMin", "number"],
      ["PostEval", "number"],
      ["SelectMainPath", "number"],
      ["Tags", "array of quoted strings | empty array"],
      ["TriggerOff", "quoted string"],
      ["TriggerOn", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeBlendTAdd",
    "agf",
    15,
    1,
    [
      ["AdditiveAlways", "number"],
      ["BlendFn", "quoted string"],
      ["BlendTime", "quoted string"],
      ["Child0", "quoted string"],
      ["Child1", "quoted string"],
      ["Condition", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["TriggerOff", "quoted string"],
      ["TriggerOn", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeBlendTW",
    "agf",
    8,
    2,
    [
      ["BlendFn", "quoted string"],
      ["BlendTime", "number"],
      ["BlendTimeFn", "quoted string"],
      ["Child0", "quoted string"],
      ["Child1", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["NodeGroup", "quoted string"],
      ["Optimization", "quoted string"],
      ["SelectMainPath", "number"],
      ["TargetWeight", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeBufferSave",
    "agf",
    17,
    9,
    [
      ["BufferName", "quoted string"],
      ["Child", "quoted string"],
      ["EditorPos", "numbers[2]"],
    ],
  ],
  [
    "AnimSrcNodeBufferUse",
    "agf",
    126,
    63,
    [
      ["BoneMask", "quoted string"],
      ["BufferName", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["NodeGroup", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeConstraint",
    "agf",
    75,
    2,
    [
      ["Child", "quoted string"],
      ["Constraint", "block"],
      ["EditorPos", "numbers[2]"],
      ["NodeGroup", "quoted string"],
      ["Weight", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeCtxBegin",
    "agf",
    23,
    13,
    [
      ["Child", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["NodeGroup", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeCtxEnd",
    "agf",
    23,
    13,
    [
      ["Child", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["NodeGroup", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeEvent",
    "agf",
    403,
    40,
    [
      ["Child", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["Events", "array of blocks"],
      ["NodeGroup", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeFuncBegin",
    "agf",
    9,
    5,
    [
      ["Child", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["NodeGroup", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeFuncCall",
    "agf",
    46,
    5,
    [
      ["Child0", "quoted string"],
      ["Child1", "quoted string"],
      ["Child2", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["Method", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeFuncEnd",
    "agf",
    9,
    5,
    [
      ["EditorPos", "numbers[2]"],
      ["NodeGroup", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeGroupSelect",
    "agf",
    1195,
    117,
    [
      ["Child", "quoted string"],
      ["Column", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["Group", "quoted string"],
      ["NodeGroup", "quoted string"],
      ["Tags", "array of quoted strings"],
    ],
  ],
  [
    "AnimSrcNodeIK2",
    "agf",
    627,
    96,
    [
      ["Chains", "array of blocks"],
      ["Child", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["NodeGroup", "quoted string"],
      ["Solver", "block"],
      ["Tags", "array of quoted strings"],
      ["Version", "number"],
      ["Weight", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeIK2BoneTarget",
    "agf",
    510,
    34,
    [
      ["Bone", "quoted string"],
      ["IkTarget", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeIK2FabrikSolver",
    "agf",
    2,
    1,
    [
      ["MaxIterations", "number"],
      ["RotationLimitPerBone", "number"],
      ["SnapRotation", "number"],
      ["TightenToTarget", "number"],
      ["TwistPropagation", "number"],
    ],
  ],
  ["AnimSrcNodeIK2LookAtSolver", "agf", 236, 24, [["Axis", "quoted string"]]],
  ["AnimSrcNodeIK2PoleSolver", "agf", 1, 1, []],
  ["AnimSrcNodeIK2RotSolver", "agf", 6, 2, []],
  [
    "AnimSrcNodeIK2Target",
    "agf",
    557,
    91,
    [
      ["Bones", "array of blocks"],
      ["Chains", "array of blocks"],
      ["Child", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["NodeGroup", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeIK2TwoBoneSolver",
    "agf",
    382,
    87,
    [
      ["AllowStretching", "number"],
      ["SnapRotation", "number"],
    ],
  ],
  [
    "AnimSrcNodeIKRot",
    "agf",
    8,
    5,
    [
      ["Chains", "array of blocks"],
      ["Child", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["NodeGroup", "quoted string"],
      ["Weight", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeJiggle",
    "agf",
    1,
    1,
    [
      ["Child", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["JiggleConstraints", "array of blocks"],
    ],
  ],
  [
    "AnimSrcNodePose",
    "agf",
    739,
    118,
    [
      ["EditorPos", "numbers[2]"],
      ["NodeGroup", "quoted string"],
      ["Source", "quoted string"],
      ["Tags", "array of quoted strings"],
      ["Time", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodePose2",
    "agf",
    211,
    57,
    [
      ["EditorPos", "numbers[2]"],
      ["Source", "quoted string"],
      ["Table", "quoted string"],
      ["ValueX", "quoted string"],
      ["ValueY", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodePrediction",
    "agf",
    727,
    41,
    [
      ["Bone", "quoted string"],
      ["Event", "quoted string"],
      ["MainPath", "number"],
      ["Name", "quoted string"],
      ["PercentTime", "number"],
      ["Rotation", "number"],
      ["Translation", "number"],
    ],
  ],
  [
    "AnimSrcNodeProcTrBoneItem",
    "agf",
    2255,
    68,
    [
      ["Amount", "quoted string"],
      ["Axis", "bare word", ["X", "Y", "Z"]],
      ["Bone", "quoted string"],
      ["Op", "bare word | quoted string", ["Rotate", "Translate"]],
      ["Operation", "bare word | quoted string", ["Rotate", "Translate"]],
      ["PivotBone", "quoted string"],
      ["PivotIk", "quoted string"],
      ["Space", "bare word", ["Local", "Model", "Pivot"]],
    ],
  ],
  [
    "AnimSrcNodeProcTrIkTargetItem",
    "agf",
    462,
    57,
    [
      ["Amount", "quoted string"],
      ["Axis", "bare word", ["X", "XYZ", "Y", "Z"]],
      ["IkTarget", "quoted string"],
      ["Op", "bare word | quoted string", ["Rotate", "Translate"]],
      ["Operation", "bare word | quoted string", ["Rotate", "Translate"]],
      ["PivotBone", "quoted string"],
      ["PivotIk", "quoted string"],
      ["Space", "bare word", ["Model", "Pivot"]],
    ],
  ],
  [
    "AnimSrcNodeProcTransform",
    "agf",
    650,
    73,
    [
      ["Bones", "array of blocks"],
      ["Child", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["Expression", "quoted string"],
      ["IkTargets", "array of blocks"],
      ["NodeGroup", "quoted string"],
      ["Tags", "array of quoted strings"],
    ],
  ],
  [
    "AnimSrcNodeQueue",
    "agf",
    483,
    71,
    [
      ["Child", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["IkTargets", "quoted string"],
      ["NodeGroup", "quoted string"],
      ["QueueItems", "array of blocks"],
      ["Tags", "array of quoted strings | empty array"],
    ],
  ],
  [
    "AnimSrcNodeQueueItem",
    "agf",
    543,
    69,
    [
      ["BlendInTime", "number"],
      ["BlendOutTime", "number"],
      ["CacheOnEnqueue", "block"],
      ["Child", "quoted string"],
      [
        "EnqueueMethod",
        "bare word",
        ["Enqueue", "Ignore", "InterruptAll", "InterruptOther", "OverlapAll", "OverlapOther"],
      ],
      ["InterruptExpr", "quoted string"],
      ["InterruptOthers", "number"],
      ["IsReentrant", "number"],
      ["StartExpr", "quoted string"],
      ["StartTime", "quoted string"],
      ["TagMainPath", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeSleep",
    "agf",
    57,
    27,
    [
      ["AwakeExpr", "quoted string"],
      ["Child", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["NodeGroup", "quoted string"],
      ["Timeout", "number"],
    ],
  ],
  [
    "AnimSrcNodeSource",
    "agf",
    4874,
    139,
    [
      ["BonesInterpolatedInModelSpace", "array of quoted strings"],
      ["EditorPos", "numbers[2]"],
      ["Interpolate", "number"],
      ["Looptype", "bare word | quoted string", ["Loop"]],
      ["NodeGroup", "quoted string"],
      ["Predictions", "array of blocks"],
      ["Source", "quoted string"],
      ["Tags", "array of quoted strings | empty array"],
    ],
  ],
  [
    "AnimSrcNodeSourceInLoopOut",
    "agf",
    4,
    2,
    [
      ["EditorPos", "numbers[2]"],
      ["EndExpression", "quoted string"],
      ["InEvent", "quoted string"],
      ["OutEvent", "quoted string"],
      ["Source", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeSourceSync",
    "agf",
    142,
    6,
    [
      ["EditorPos", "numbers[2]"],
      ["Looptype", "bare word | quoted string", ["Loop"]],
      ["NodeGroup", "quoted string"],
      ["Predictions", "array of blocks"],
      ["Source", "quoted string"],
      ["SyncLine", "quoted string"],
      ["Tags", "empty array"],
    ],
  ],
  [
    "AnimSrcNodeState",
    "agf",
    6531,
    139,
    [
      ["Child", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["IsExit", "number"],
      ["NodeGroup", "quoted string"],
      ["PassThrough", "number"],
      ["StartCondition", "quoted string"],
      ["StartTime", "quoted string"],
      ["Tags", "array of quoted strings | empty array"],
      ["TimeStorage", "bare word | quoted string", ["Inherit"]],
    ],
  ],
  [
    "AnimSrcNodeStateMachine",
    "agf",
    1486,
    139,
    [
      ["EditorPos", "numbers[2]"],
      ["NodeGroup", "quoted string"],
      ["Tags", "array of quoted strings | empty array"],
      ["states", "array of blocks"],
      ["transitions", "array of blocks"],
    ],
  ],
  [
    "AnimSrcNodeSwitch",
    "agf",
    31,
    8,
    [
      ["BlendTime", "number"],
      ["EditorPos", "numbers[2]"],
      ["FirstProbabilities", "quoted string"],
      ["NodeGroup", "quoted string"],
      ["SwitchItems", "array of blocks"],
      ["Tags", "array of quoted strings"],
    ],
  ],
  [
    "AnimSrcNodeSwitchItem",
    "agf",
    98,
    8,
    [
      ["Child", "quoted string"],
      ["NextProbabilities", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeTimeSave",
    "agf",
    3,
    2,
    [
      ["Child", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["NodeGroup", "quoted string"],
      ["TimeName", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeTimeScale",
    "agf",
    182,
    45,
    [
      ["Child", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["NodeGroup", "quoted string"],
      ["Tags", "array of quoted strings"],
      ["TimeExpr", "quoted string"],
      ["TimeMappingTable", "array of numbers"],
      ["TimeStorage", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeTimeUse",
    "agf",
    3,
    3,
    [
      ["Child", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["TimeName", "quoted string"],
      ["TimeType", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeTransition",
    "agf",
    6183,
    137,
    [
      ["BlendFn", "bare word | quoted string"],
      ["Condition", "quoted string"],
      ["Duration", "quoted string"],
      ["Events", "array of blocks"],
      ["FromState", "quoted string"],
      ["MotionVecBlend", "number | numbers[2]"],
      ["PostEval", "number"],
      ["Priority", "number"],
      ["Reentering", "bare word | quoted string", ["Forbidden"]],
      ["StartTime", "quoted string"],
      ["Tags", "array of quoted strings"],
      ["ToState", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeVarSet",
    "agf",
    73,
    26,
    [
      ["Child", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["NodeGroup", "quoted string"],
      ["VarSet", "array of blocks"],
    ],
  ],
  [
    "AnimSrcNodeVarSetFloatItem",
    "agf",
    85,
    26,
    [
      ["PostEval", "number"],
      ["SetOnBlendOut", "number"],
      ["SetOnInit", "number"],
      ["SetOnMainPath", "number"],
      ["Value", "quoted string"],
      ["VariableName", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeVarSetIntItem",
    "agf",
    9,
    2,
    [
      ["SetOnBlendOut", "number"],
      ["SetOnMainPath", "number"],
      ["Value", "quoted string"],
      ["VariableName", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeVarUpdate",
    "agf",
    201,
    40,
    [
      ["Child", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["NodeGroup", "quoted string"],
      ["Varupdate", "array of blocks"],
    ],
  ],
  [
    "AnimSrcNodeVarUpdateItem",
    "agf",
    252,
    40,
    [
      ["Condition", "quoted string"],
      ["IsCyclic", "number"],
      ["MaxDifferencePerSecond", "number"],
      ["UpdateOnBlendOut", "number"],
      ["UpdateOnInit", "number"],
      ["UpdateOnMainPath", "number"],
      ["VariableName", "quoted string"],
    ],
  ],
  [
    "AnimSrcNodeWeaponIk",
    "agf",
    8,
    4,
    [
      ["BlendInTime", "number"],
      ["BlendOutTime", "number"],
      ["Child", "quoted string"],
      ["EditorPos", "numbers[2]"],
      ["Ikconfig", "quoted string"],
      ["IkconfigName", "quoted string"],
      ["WeaponDirLr", "quoted string"],
      ["WeaponDirUd", "quoted string"],
      ["WeaponRoll", "quoted string"],
      ["WeaponTransX", "quoted string"],
      ["WeaponTransY", "quoted string"],
      ["WeaponTransZ", "quoted string"],
      ["WeightAim", "quoted string"],
      ["WeightPrimaryChain", "quoted string"],
      ["WeightSecondaryChain", "quoted string"],
    ],
  ],
  [
    "AnimSrcSyncEvent",
    "asy",
    67,
    2,
    [
      ["Event", "quoted string"],
      ["Ntime", "number"],
    ],
  ],
  ["AnimSrcSyncLine", "asy", 22, 2, [["SyncPoints", "array of blocks"]]],
  ["AnimSrcSyncTable", "aex+asy", 3, 3, [["SyncLines", "array of blocks"]]],
  [
    "AnimSrcTransformOffset",
    "agf",
    48,
    34,
    [
      ["BonesAreInModelSpace", "number"],
      ["FromBone", "quoted string"],
      ["FromFrame", "number"],
      ["Pose", "quoted string"],
      ["Position", "numbers[3]"],
      ["Rotation", "numbers[3]"],
      ["ToBone", "quoted string"],
      ["ToFrame", "number"],
    ],
  ],
  ["AnimSrcVarCmdTempStorage", "agf", 45, 21, [["Commands", "array of quoted strings"]]],
  ["AnimSrcWorkspaceAudioProject", "aw", 106, 32, [["ProjectFile", "resource ref"]]],
  ["AnimSrcWorkspaceAudioTesting", "aw", 131, 131, [["AudioProjects", "array of blocks"]]],
  [
    "AnimSrcWorkspaceChildPreviewModel",
    "aw",
    47,
    38,
    [
      ["Bone", "quoted string"],
      ["ChildBone", "quoted string"],
      ["Enabled", "bare word | number"],
      ["Model", "resource ref"],
      ["OffsetRotation", "numbers[3]"],
      ["Parent", "quoted string"],
    ],
  ],
  [
    "AnimSrcWorkspaceIkTargetPlaneTest",
    "aw",
    1,
    1,
    [
      ["BindingName", "quoted string"],
      ["Enabled", "number"],
      ["Normal", "numbers[3]"],
      ["Position", "numbers[3]"],
    ],
  ],
  [
    "AnimSrcWorkspaceIkTargetTest",
    "aw",
    18,
    7,
    [
      ["BindingName", "quoted string"],
      ["Enabled", "number"],
      ["Position", "numbers[3]"],
      ["Rotation", "numbers[3]"],
    ],
  ],
  [
    "AnimSrcWorkspaceIkTesting",
    "aw",
    131,
    131,
    [
      ["IkPlanes", "array of blocks"],
      ["IkTargets", "array of blocks"],
    ],
  ],
  [
    "AnimSrcWorkspacePreviewModel",
    "aw",
    255,
    131,
    [
      ["HiddenMaterials", "empty array"],
      ["Model", "resource ref"],
    ],
  ],
  [
    "BaseSource",
    "aw",
    131,
    131,
    [
      ["AnimGraph", "resource ref"],
      ["AnimSetInstances", "array of resource refs"],
      ["AnimSetTemplate", "resource ref"],
      ["AudioTesting", "block"],
      ["ChildPreviewModels", "array of blocks"],
      ["ExpressionTable", "resource ref"],
      ["IkTesting", "block"],
      ["PreviewModels", "array of blocks"],
      ["SyncTable", "resource ref"],
    ],
  ],
];

export type CatalogKind = "node" | "item" | "event" | "graph" | "file" | "legacy" | "other";

export interface CatalogKey {
  name: string;
  /** Value shape seen in vanilla (`quoted string`, `number`, `numbers[2]`, `array of blocks`, ...). */
  signature: string;
  /** For an enum-like key, the bare literal values seen in vanilla. */
  values?: string[];
}

export interface CatalogClass {
  name: string;
  kind: CatalogKind;
  /** File extension(s) the class appears in (`agf`, `agr`, `aex+asy`, ...). */
  ext: string;
  instances: number;
  files: number;
  keys: CatalogKey[];
}

const ITEM = /^AnimSrcNode\w*Item$/;

/** How the catalog groups a class: a graph node, a node's nested item, an event, and so on. */
export function kindOf(name: string): CatalogKind {
  if (name.startsWith("$")) return "legacy";
  if (ITEM.test(name) || name === "AnimSrcNodeState" || name === "AnimSrcNodeTransition") {
    return "item";
  }
  if (name.startsWith("AnimSrcNode")) return "node";
  if (/Event/.test(name)) return "event";
  if (/^AnimSrc(GCT|GD|Graph|Ik|Debug)/.test(name)) return "graph";
  if (
    /^(AnimSet|AnimSrcWorkspace|AnimEventTable|AnimSrcSyncTable|AnimSrcExpressionTable)/.test(name)
  ) {
    return "file";
  }
  return "other";
}

let cache: Map<string, CatalogClass> | undefined;

/** Every class of the catalog by name. */
export function catalog(): Map<string, CatalogClass> {
  if (cache) return cache;
  cache = new Map();
  for (const [name, ext, instances, files, keys] of ROWS) {
    cache.set(name, {
      name,
      kind: kindOf(name),
      ext,
      instances,
      files,
      keys: keys.map(([k, signature, values]) =>
        values ? { name: k, signature, values } : { name: k, signature },
      ),
    });
  }
  return cache;
}

/** The class of that name, or undefined. */
export function catalogClass(name: string): CatalogClass | undefined {
  return catalog().get(name);
}

/** True when `name` is a graph node class of the catalog (kind node). */
export function isNodeClass(name: string): boolean {
  return catalogClass(name)?.kind === "node";
}

/** Every enum-like key: class, key and its literal values. */
export function catalogEnums(): { class: string; key: string; values: string[] }[] {
  const out: { class: string; key: string; values: string[] }[] = [];
  for (const c of catalog().values()) {
    for (const k of c.keys)
      if (k.values) out.push({ class: c.name, key: k.name, values: k.values });
  }
  return out;
}
