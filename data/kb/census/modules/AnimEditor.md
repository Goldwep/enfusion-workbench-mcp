# Census: AnimEditor

1096 rows (20 aggregate excluded).

## What it is

Module AnimEditor: api 65, diag 1, file 12, link 2, net 7, schema 529, setting 35, ui 445. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- class AnimEditor (api:AnimEditor)
- class AnimSrcIkBinding (api:AnimSrcIkBinding): IkTarget + IkChain pair (1,056)
- class AnimSrcNodePrediction (api:AnimSrcNodePrediction): Name, Bone, Event, PercentTime, Translation, Rotation, MainPath (575)
- class AnimSrcNodeQueueItem (api:AnimSrcNodeQueueItem): Child, StartExpr, InterruptExpr, BlendIn/OutTime, EnqueueMethod, TagMainPath, CacheOnEnqueue (441)
- class AnimSrcNodeSwitchItem (api:AnimSrcNodeSwitchItem): Child, NextProbabilities (92)
- class AnimSrcNodeTransition (api:AnimSrcNodeTransition): FromState, ToState, Condition, Duration, StartTime, BlendFn, PostEval, Priority, MotionVecBlend, Reentering, Events, Tags (5,405)
- class AnimSrcNodeVarUpdateItem (api:AnimSrcNodeVarUpdateItem): VariableName, UpdateOnInit/MainPath/BlendOut, PostEval, Condition, MaxDifferencePerSecond, IsCyclic (200)
- class AnimSrcTransformOffset (api:AnimSrcTransformOffset): Position, Rotation, Pose, FromBone, ToBone, FromFrame, ToFrame, BonesAreInModelSpace (47)
- class Constraints (api:Constraints): AnimSrcConstraintPosition, Parent, Distance, Relation, CustomSpace
- class AnimSrcNodeAttachment (wiki: Attachment) (api:class/AnimSrcNodeAttachment (wiki: Attachment)): Link to another graph by binding name. Vanilla instances: 10
- class AnimSrcNodeAuxOut (wiki: (not in wiki)) (api:class/AnimSrcNodeAuxOut (wiki: (not in wiki))): Unknown; items AuxOutBoneItem / AuxOutIkTargetItem. Vanilla instances: 0
- class AnimSrcNodeBindPose (wiki: Bind Pose) (api:class/AnimSrcNodeBindPose (wiki: Bind Pose)): Sample bind pose. Vanilla instances: 89
- ... 213 more

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| api | 64 | 0 | 1 | 0 | 0 | 0 | 65 |
| diag | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| file | 3 | 0 | 9 | 0 | 0 | 0 | 12 |
| link | 0 | 1 | 1 | 0 | 0 | 0 | 2 |
| net | 7 | 0 | 0 | 0 | 0 | 0 | 7 |
| schema | 1 | 1 | 527 | 0 | 0 | 0 | 529 |
| setting | 35 | 0 | 0 | 0 | 0 | 0 | 35 |
| ui | 203 | 91 | 137 | 1 | 0 | 13 | 445 |

## By kind

- canvas-gesture: 8
- class: 58
- context-item: 8
- control: 120
- diag-option: 1
- dialog: 4
- dock: 14
- enum: 6
- file-type: 12
- link-format: 2
- menu: 13
- menu-item: 80
- method: 1
- module: 1
- net-handler: 7
- option: 11
- panel: 33
- property: 1
- property-group: 15
- region: 39
- schema-class: 106
- schema-key: 422
- setting-key: 35
- shortcut: 18
- status-item: 1
- tab: 20
- toolbar: 7
- toolbar-button: 52
- window: 1

## By risk

- destructive: 3
- mutating: 325
- safe: 768

## Rows by kind

### canvas-gesture (8)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AnimEditor/canvas-gesture/Anim Editor Preview/The camera can be moved | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/canvas-gesture/Anim Editor Preview/The camera can be rotated around its own axis | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/canvas-gesture/Anim Editor Preview/The camera can be rotated around the center | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/canvas-gesture/Animation Graph/Left Click to select | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/canvas-gesture/Animation Graph/add to current selection | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/canvas-gesture/Animation Graph/move around the graph | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/canvas-gesture/Animation Graph/opens a contextual menu | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/canvas-gesture/Animation Graph/zoom%2Funzoom | T0/T2 | candidate: gui-automation | none |

### class (58)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:AnimEditor | T2/T2 | candidate: none-known | none |
| api:AnimSrcIkBinding | T0/T2 | candidate: file-format | none |
| api:AnimSrcNodePrediction | T0/T2 | candidate: file-format | none |
| api:AnimSrcNodeQueueItem | T0/T2 | candidate: file-format | none |
| api:AnimSrcNodeSwitchItem | T0/T2 | candidate: file-format | none |
| api:AnimSrcNodeTransition | T0/T2 | candidate: file-format | none |
| api:AnimSrcNodeVarUpdateItem | T0/T2 | candidate: file-format | none |
| api:AnimSrcTransformOffset | T0/T2 | candidate: file-format | none |
| api:Constraints | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeAttachment (wiki: Attachment) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeAuxOut (wiki: (not in wiki)) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeBindPose (wiki: Bind Pose) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeBlend (wiki: Blend) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeBlendN (wiki: Blend N) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeBlendT (wiki: Blend T) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeBlendTAdd (wiki: Blend T Add) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeBlendTW (wiki: Blend TW) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeBufferSave (wiki: Buffer Save) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeBufferUse (wiki: Buffer Use) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeConstraint (wiki: Constraint) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeEvent (wiki: Event) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeFilter (wiki: Filter) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeFuncBegin (wiki: Function Begin) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeFuncCall (wiki: Function Call) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeFuncEnd (wiki: Function End) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeGroupSelect (wiki: Group Select) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeIK2 (wiki: IK2) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeIK2Target (wiki: IK2 Target) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeIKRot (wiki: IK Rotation) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeJiggle (wiki: (not in wiki)) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeLastPose (wiki: (not in wiki)) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeParentPose (wiki: (not in wiki)) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodePendulum (wiki: (not in wiki)) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodePose (wiki: Pose) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodePose2 (wiki: Pose 2) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodePoseDrivenRbf (wiki: (not in wiki)) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodePoseRbf (wiki: RBF (probable match)) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeProcTransform (wiki: Procedural) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeQueue (wiki: Queue) | T0/T2 | candidate: file-format | none |
| api:class/AnimSrcNodeSleep (wiki: Sleep) | T0/T2 | candidate: file-format | none |

18 more: wb_census find with module=AnimEditor kind=class.

### context-item (8)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AnimEditor/context-item/Anim Set: Unassign animations | T0/T5 | candidate: file-format | none |
| ui:AnimEditor/context-item/Assign Existing Template... | T0/T5 | candidate: file-format | none |
| ui:AnimEditor/context-item/Create New Event Table | T0/T5 | candidate: file-format | none |
| ui:AnimEditor/context-item/New Animation Instance... | T0/T5 | candidate: file-format | none |
| ui:AnimEditor/context-item/New Sheet... | T0/T5 | candidate: file-format | none |
| ui:AnimEditor/context-item/New Template... | T0/T5 | candidate: file-format | none |
| ui:AnimEditor/context-item/Register and Import (.txa) | T0/T5 | candidate: net-api-handler | none |
| ui:AnimEditor/context-item/Set node as default running node | T0/T5 | candidate: file-format | none |

### control (120)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AnimEditor/control/#Maximize-Restore | T2/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/#Minimize-Restore | T2/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/#lstControllers | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/#navigateBackward | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/#navigateForward | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/#navigateUp | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/#workspace | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/.anm Edit mode: Custom Properties | T0/T5 | candidate: net-api-handler | none |
| ui:AnimEditor/control/.anm Edit mode: Events | T0/T5 | candidate: gui-automation, net-api-handler | none |
| ui:AnimEditor/control/13380 items | T2/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@AnimEditorAnimSetTreeWidget.1 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@PropEditBox.1 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@PropPushButton.1 | T2/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@PropPushButton.2 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QComboBox.1 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QComboBox.1/@QLineEdit.1 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QComboBox.2 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QComboBox.3 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QLineEdit.1 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QLineEdit.2 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QLineEdit.3 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QLineEdit.3/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QLineEdit.4 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QLineEdit.4/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QLineEdit.5 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QLineEdit.5/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QPushButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QPushButton.10 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QPushButton.11 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QPushButton.12 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QPushButton.13 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QPushButton.14 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QPushButton.15 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QPushButton.16 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QPushButton.17 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QPushButton.18 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QPushButton.19 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QPushButton.2 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QPushButton.20 | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/control/@QPushButton.21 | T0/T5 | candidate: gui-automation | none |

80 more: wb_census find with module=AnimEditor kind=control.

### diag-option (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| diag:diag-option/Diag: Animation > Start Debugger | T0/T2 | candidate: gui-automation | none |

### dialog (4)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AnimEditor/dialog/AnimEditorAnimationChannels | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/dialog/AnimEditorBones | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/dialog/AnimEditorEventTransfer | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/dialog/AnimEditorPreviewOptionsDialog | T0/T3 | candidate: gui-automation | none |

### dock (14)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AnimEditor/dock/#Animation%20Sets | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/dock/#Attachments%20Debug | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/dock/#Channel%20Curves | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/dock/#Controls | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/dock/#Debug%20Controls | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/dock/#Errors | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/dock/#File%20Browser | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/dock/#Graph | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/dock/#IkTestings%20Debug | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/dock/#Live%20Debug | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/dock/#Log%20Console | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/dock/#Preview | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/dock/#Properties | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/dock/#Workspace | T0/T3 | candidate: gui-automation | none |

### enum (6)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:enum/Enum BlendFn | T0/T2 | candidate: file-format | none |
| api:enum/Enum EnqueueMethod | T0/T2 | candidate: file-format | none |
| api:enum/Enum IkTargets blending | T0/T2 | candidate: file-format | none |
| api:enum/Enum Looptype | T0/T2 | candidate: file-format | none |
| api:enum/Enum Optimization | T0/T2 | candidate: file-format | none |
| api:enum/Enum TimeStorage | T0/T2 | candidate: file-format | none |

### file-type (12)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| file:.ae | T2/T3 | candidate: file-format | none |
| file:.agf | T2/T3 | candidate: file-format | [animation_find_unused_clips.run](../tools/animation_find_unused_clips.md) read, [animation_graph.author](../tools/animation_graph.md) read, [animation_graph.edit](../tools/animation_graph.md) drive, [animation_graph.inspect](../tools/animation_graph.md) read, [animation_graph.nodes](../tools/animation_graph.md) read, [animation_graph.setup](../tools/animation_graph.md) read, [animation_graph.validate](../tools/animation_graph.md) read |
| file:.agr | T2/T3 | candidate: file-format | [animation_find_unused_clips.run](../tools/animation_find_unused_clips.md) read, [animation_graph.author](../tools/animation_graph.md) read, [animation_graph.edit](../tools/animation_graph.md) drive, [animation_graph.inspect](../tools/animation_graph.md) read, [animation_graph.nodes](../tools/animation_graph.md) read, [animation_graph.setup](../tools/animation_graph.md) read, [animation_graph.validate](../tools/animation_graph.md) read, [weapon_pose_lint.run](../tools/weapon_pose_lint.md) read |
| file:.anm | T2/T3 | candidate: file-format | [animation_find_unused_clips.run](../tools/animation_find_unused_clips.md) read, [animation_graph.author](../tools/animation_graph.md) read, [animation_graph.inspect](../tools/animation_graph.md) read, [animation_graph.setup](../tools/animation_graph.md) read |
| file:.asi | T2/T3 | candidate: file-format | [animation_find_unused_clips.run](../tools/animation_find_unused_clips.md) read, [animation_graph.author](../tools/animation_graph.md) read, [animation_graph.inspect](../tools/animation_graph.md) read, [animation_graph.setup](../tools/animation_graph.md) read, [animation_set.map](../tools/animation_set.md) drive, [animation_set.read](../tools/animation_set.md) read, [animation_set.unmap](../tools/animation_set.md) drive, [animation_set.validate](../tools/animation_set.md) read |
| file:.ast | T2/T3 | candidate: file-format | [animation_graph.author](../tools/animation_graph.md) read, [animation_graph.inspect](../tools/animation_graph.md) read, [animation_graph.setup](../tools/animation_graph.md) read, [animation_set.addAnimation](../tools/animation_set.md) drive, [animation_set.addColumn](../tools/animation_set.md) drive, [animation_set.addGroup](../tools/animation_set.md) drive, [animation_set.create](../tools/animation_set.md) drive, [animation_set.read](../tools/animation_set.md) read, [animation_set.validate](../tools/animation_set.md) read |
| file:.asy | T2/T3 | candidate: file-format | none |
| file:.aw | T2/T3 | candidate: file-format | [animation_graph.author](../tools/animation_graph.md) read, [animation_graph.inspect](../tools/animation_graph.md) read, [animation_graph.setup](../tools/animation_graph.md) read, [animation_workspace.create](../tools/animation_workspace.md) drive, [animation_workspace.duplicate](../tools/animation_workspace.md) drive, [animation_workspace.files](../tools/animation_workspace.md) read, [animation_workspace.read](../tools/animation_workspace.md) read, [animation_workspace.set](../tools/animation_workspace.md) drive, [animation_workspace.validate](../tools/animation_workspace.md) read |
| file:.txa | T2/T3 | candidate: file-format | none |
| file:file-type/.adbg animation debug recording | T0/T3 | candidate: file-format | none |
| file:file-type/.apr export profile | T0/T3 | candidate: builtin-net-handler, file-format | none |
| file:file-type/.fbxa animation source | T0/T3 | candidate: builtin-net-handler, net-api-handler | none |

### link-format (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| link:enfusion://AnimEditor | T1/T5 | candidate: cli | [wb_link.build](../tools/wb_link.md) read, [wb_link.open](../tools/wb_link.md) drive, [wb_link.parse](../tools/wb_link.md) read |
| link:https://community.bistudio.com/wiki/Arma_Reforger:Animation_Editor | T2/T5 | candidate: file-format | none |

### menu (13)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AnimEditor/menu/Checks | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/menu/Edit | T2/T3 | candidate: gui-automation | none |
| ui:AnimEditor/menu/File | T2/T3 | candidate: gui-automation | none |
| ui:AnimEditor/menu/Graph | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/menu/Help | T2/T3 | candidate: gui-automation | none |
| ui:AnimEditor/menu/Play | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/menu/Tools | T2/T3 | candidate: gui-automation | none |
| ui:AnimEditor/menu/Track | T2/T3 | candidate: gui-automation | none |
| ui:AnimEditor/menu/Track (menu) | T0/T3 | candidate: execute-action | none |
| ui:AnimEditor/menu/View | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/menu/Window | T2/T3 | candidate: gui-automation | none |
| ui:AnimEditor/menu/Window/Go to... | T2/T3 | candidate: gui-automation | none |
| ui:AnimEditor/menu/Window/Layout | T2/T3 | candidate: gui-automation | none |

### menu-item (80)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AnimEditor/menu-item/Bake Recording to TXA... | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/menu-item/Close Workspace | T0/T5 | candidate: execute-action | none |
| ui:AnimEditor/menu-item/Duplicate Workspace | T0/T5 | candidate: execute-action, file-format | none |
| ui:AnimEditor/menu-item/Edit/Copy | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/menu-item/Edit/Cut | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/menu-item/Edit/Paste | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/menu-item/Edit/Redo | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/menu-item/Edit/Undo | T3/T5 | candidate: execute-action, gui-automation | [wb_module.action](../tools/wb_module.md) drive |
| ui:AnimEditor/menu-item/Exit | T0/T2 | candidate: net-api-handler | none |
| ui:AnimEditor/menu-item/Export Recording... | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/menu-item/Expression Performance Stress Test | T0/T5 | candidate: execute-action | none |
| ui:AnimEditor/menu-item/File/Close Workspace | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/menu-item/File/Duplicate Workspace | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/menu-item/File/Exit | T2/T2 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/menu-item/File/New Workspace | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/menu-item/File/Open Workspace | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/menu-item/File/Options... | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/menu-item/File/Save Animations | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/menu-item/File/Save Workspace | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/menu-item/Find all tags... | T0/T5 | candidate: file-format | none |
| ui:AnimEditor/menu-item/Find broken animation loops... | T0/T5 | candidate: execute-action | none |
| ui:AnimEditor/menu-item/Go to... | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/menu-item/Help/View Help | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/menu-item/Import Recording... | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/menu-item/Locate file | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/menu-item/New Workspace | T0/T5 | candidate: execute-action, file-format | none |
| ui:AnimEditor/menu-item/Open Workspace... | T0/T5 | candidate: net-api-handler | none |
| ui:AnimEditor/menu-item/Performance Stress Test | T0/T5 | candidate: execute-action | none |
| ui:AnimEditor/menu-item/Play Default Node | T0/T5 | candidate: execute-action | none |
| ui:AnimEditor/menu-item/Randomize Inputs | T0/T5 | candidate: execute-action | none |
| ui:AnimEditor/menu-item/Rebuild Animations... | T0/T5 | candidate: execute-action, net-api-handler | none |
| ui:AnimEditor/menu-item/Reload Animations | T0/T5 | candidate: execute-action | none |
| ui:AnimEditor/menu-item/Repair Duplicate Channels in TXA files... | T0/T5 | candidate: execute-action | none |
| ui:AnimEditor/menu-item/Resave Workspaces... | T0/T5 | candidate: execute-action | none |
| ui:AnimEditor/menu-item/Save Animations | T0/T5 | candidate: execute-action | none |
| ui:AnimEditor/menu-item/Save Workspace | T0/T5 | candidate: execute-action, net-api-handler | none |
| ui:AnimEditor/menu-item/Tools/Expression Performance Stress Test | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/menu-item/Tools/Find all tags... | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/menu-item/Tools/Find broken animation loops... | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/menu-item/Tools/Performance Stress Test | T2/T5 | candidate: execute-action, gui-automation | none |

40 more: wb_census find with module=AnimEditor kind=menu-item.

### method (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:method/Runtime graph control | T0/T5 | candidate: net-api-handler | none |

### module (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AnimEditor/module/AnimEditor | T1/T5 | candidate: builtin-net-handler, net-api-handler | [wb_module.info](../tools/wb_module.md) drive |

### net-handler (7)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| net:net-handler/Builtin handler AnimExportProfileChannels | T0/T5 | candidate: builtin-net-handler | none |
| net:net-handler/Builtin handler AnimExportProfiles | T0/T5 | candidate: builtin-net-handler | none |
| net:net-handler/Builtin handler AnimExportTrackExport | T0/T5 | candidate: builtin-net-handler | none |
| net:net-handler/Builtin handler ExportTXAResource | T0/T5 | candidate: builtin-net-handler | none |
| net:net-handler/Builtin handler GetResourceInfo (TXAResourceClass branch) | T0/T5 | candidate: builtin-net-handler | none |
| net:net-handler/Builtin handler RegisterResource | T0/T5 | candidate: builtin-net-handler | none |
| net:net-handler/Other 28 shipped NetApiHandler classes | T0/T5 | candidate: builtin-net-handler | none |

### option (11)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AnimEditor/option/Anim Editor Preview/Timeline Controls/Show Motion Options/Inplace | T1/T5 | candidate: file-format, gui-automation | none |
| ui:AnimEditor/option/Anim Editor Preview/Timeline Controls/Show Motion Options/Move And Rotate Ground | T1/T5 | candidate: file-format, gui-automation | none |
| ui:AnimEditor/option/Anim Editor Preview/Timeline Controls/Show Motion Options/Move Entity | T1/T5 | candidate: file-format, gui-automation | none |
| ui:AnimEditor/option/Anim Editor Preview/Timeline Controls/Show Motion Options/Move Entity, Reset Movement Each Loop | T1/T5 | candidate: file-format, gui-automation | none |
| ui:AnimEditor/option/Anim Editor Preview/Timeline Controls/Show Motion Options/Move Ground | T1/T5 | candidate: file-format, gui-automation | none |
| ui:AnimEditor/option/Animation export profile directory | T0/T5 | candidate: net-api-handler | none |
| ui:AnimEditor/option/Event Filter option | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/option/Generate Default Profile (model import setting) | T0/T5 | candidate: net-api-handler | none |
| ui:AnimEditor/option/Node colours | T0/T5 | candidate: gui-automation | none |
| ui:AnimEditor/option/Perspectives | T0/T5 | candidate: file-format, gui-automation | none |
| ui:AnimEditor/option/RecentFiles | T0/T5 | candidate: file-format, gui-automation | none |

### panel (33)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AnimEditor/panel/@QMainWindowTabBar.1 | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/panel/@QMainWindowTabBar.2 | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/panel/@QMainWindowTabBar.3 | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/panel/@QStatusBar.1 | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/panel/Anim Editor Preview | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/panel/Anim Set | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/panel/Animation Graph | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/panel/Animation Sets dock | T0/T3 | candidate: file-format | none |
| ui:AnimEditor/panel/Attachments Debug | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/panel/Attachments Debug dock | T0/T3 | candidate: file-format, gui-automation | none |
| ui:AnimEditor/panel/Channel Curves dock | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/panel/Controls | T2/T3 | candidate: gui-automation | none |
| ui:AnimEditor/panel/Controls dock | T0/T3 | candidate: file-format | none |
| ui:AnimEditor/panel/Debug Controls | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/panel/Debug Controls dock | T0/T3 | candidate: file-format | none |
| ui:AnimEditor/panel/Errors | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/panel/Errors dock | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/panel/File Browser | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/panel/File Browser dock | T0/T3 | candidate: file-format | none |
| ui:AnimEditor/panel/Graph | T2/T3 | candidate: gui-automation | none |
| ui:AnimEditor/panel/Graph dock | T0/T3 | candidate: file-format | none |
| ui:AnimEditor/panel/IkTestings Debug dock | T0/T3 | candidate: file-format | none |
| ui:AnimEditor/panel/Live Debug | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/panel/Live Debug dock | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/panel/Log Console | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/panel/Log Console dock | T0/T3 | candidate: file-format | none |
| ui:AnimEditor/panel/Preview dock | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/panel/Properties | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/panel/Properties dock | T0/T3 | candidate: file-format | none |
| ui:AnimEditor/panel/Sync Table editing | T0/T3 | candidate: file-format | none |
| ui:AnimEditor/panel/Workspace | T2/T3 | candidate: gui-automation | none |
| ui:AnimEditor/panel/Workspace dock | T0/T3 | candidate: file-format, gui-automation | none |
| ui:AnimEditor/panel/mainToolBar | T0/T3 | candidate: execute-action | none |

### property (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:property/DefaultRunNode | T0/T2 | candidate: file-format | none |

### property-group (15)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AnimEditor/property-group/#propertyGridControlTemplate | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/property-group/Audio projects for preview | T0/T3 | candidate: file-format | none |
| ui:AnimEditor/property-group/Bone Masks | T0/T3 | candidate: file-format | none |
| ui:AnimEditor/property-group/Commands | T0/T3 | candidate: file-format | none |
| ui:AnimEditor/property-group/Curves | T0/T3 | candidate: file-format | none |
| ui:AnimEditor/property-group/Expression Table | T0/T3 | candidate: file-format | none |
| ui:AnimEditor/property-group/Global Tags | T0/T3 | candidate: file-format | none |
| ui:AnimEditor/property-group/Hidden materials | T0/T3 | candidate: file-format | none |
| ui:AnimEditor/property-group/IK Chains | T0/T3 | candidate: file-format | none |
| ui:AnimEditor/property-group/Instance IK pose | T0/T3 | candidate: file-format | none |
| ui:AnimEditor/property-group/Instance RBF data | T0/T3 | candidate: file-format | none |
| ui:AnimEditor/property-group/Instance parent templates | T0/T3 | candidate: file-format | none |
| ui:AnimEditor/property-group/Node groups | T0/T3 | candidate: file-format | none |
| ui:AnimEditor/property-group/Prefab links to graphs | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:AnimEditor/property-group/Twist bones | T0/T3 | candidate: file-format | none |

### region (39)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AnimEditor/region/#SystemMenuBar | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/#animEditorGraphControl | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/#qt_splithandle_gridPanel | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/#timeLine | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@BreadcrumbTrailWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@CurveView.1 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@CurveView.2 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QMenuBar.1 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QScrollBar.1 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QScrollBar.2 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QScrollBar.3 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QScrollBar.4 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QSplitterHandle.1 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QSplitterHandle.2 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QStatusBar.1/@QSizeGrip.1 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QToolBar.1/@QToolBarSeparator.1 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QToolBar.1/@QToolBarSeparator.2 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QToolBar.1/@QToolBarSeparator.3 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QToolBar.2/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QWidget.10 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QWidget.2 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QWidget.3 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QWidget.4 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QWidget.5 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QWidget.6 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QWidget.7 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QWidget.8 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@QWidget.9 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@SceneRenderWindow.1 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@SearchComboBox.1 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/@TitleBar.1 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/mainToolBar/@QLabel.1 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/mainToolBar/@QToolBarSeparator.1 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/mainToolBar/@QToolBarSeparator.2 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/mainToolBar/@QToolBarSeparator.3 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/mainToolBar/@QToolBarSeparator.4 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/mainToolBar/@QToolBarSeparator.5 | T0/T2 | candidate: gui-automation | none |
| ui:AnimEditor/region/mainToolBar/@QToolBarSeparator.6 | T0/T2 | candidate: gui-automation | none |

### schema-class (106)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:$AnimGraph | T2/T2 | candidate: file-format | none |
| schema:$EditorData | T2/T2 | candidate: file-format | none |
| schema:$Node | T2/T2 | candidate: file-format | none |
| schema:$Predictions | T2/T2 | candidate: file-format | none |
| schema:$Sheet | T2/T2 | candidate: file-format | none |
| schema:$State | T2/T2 | candidate: file-format | none |
| schema:$States | T2/T2 | candidate: file-format | none |
| schema:$Transition | T2/T2 | candidate: file-format | none |
| schema:$Transitions | T2/T2 | candidate: file-format | none |
| schema:$eventtable | T2/T2 | candidate: file-format | none |
| schema:AnimEventTable | T2/T2 | candidate: file-format | none |
| schema:AnimSetInstanceSource | T2/T2 | candidate: file-format | none |
| schema:AnimSetInstanceSourceRBFArray | T2/T2 | candidate: file-format | none |
| schema:AnimSetInstanceSource_Line | T2/T2 | candidate: file-format | none |
| schema:AnimSetTemplateSource | T2/T2 | candidate: file-format | none |
| schema:AnimSetTemplateSource_AnimationGroup | T2/T2 | candidate: file-format | none |
| schema:AnimSrcConstraintParent | T2/T2 | candidate: file-format | none |
| schema:AnimSrcDebugCtlCmd | T2/T2 | candidate: file-format | none |
| schema:AnimSrcDebugCtlGroup | T2/T2 | candidate: file-format | none |
| schema:AnimSrcDebugCtlVar | T2/T2 | candidate: file-format | none |
| schema:AnimSrcEvent | T2/T2 | candidate: file-format | none |
| schema:AnimSrcEventGeneric | T2/T2 | candidate: file-format | none |
| schema:AnimSrcGCT | T2/T2 | candidate: file-format | none |
| schema:AnimSrcGCTBoneMask | T2/T2 | candidate: file-format | none |
| schema:AnimSrcGCTCmd | T2/T2 | candidate: file-format | none |
| schema:AnimSrcGCTCurve | T2/T2 | candidate: file-format | none |
| schema:AnimSrcGCTCurveLib | T2/T2 | candidate: file-format | none |
| schema:AnimSrcGCTIkChain | T2/T2 | candidate: file-format | none |
| schema:AnimSrcGCTVarBool | T2/T2 | candidate: file-format | none |
| schema:AnimSrcGCTVarFloat | T2/T2 | candidate: file-format | none |
| schema:AnimSrcGCTVarInt | T2/T2 | candidate: file-format | none |
| schema:AnimSrcGCTVarString | T2/T2 | candidate: file-format | none |
| schema:AnimSrcGD | T2/T2 | candidate: file-format | none |
| schema:AnimSrcGraph | T2/T2 | candidate: file-format | none |
| schema:AnimSrcGraphFile | T2/T2 | candidate: file-format | none |
| schema:AnimSrcGraphNodeGroup | T2/T2 | candidate: file-format | none |
| schema:AnimSrcGraphSheet | T2/T2 | candidate: file-format | none |
| schema:AnimSrcIkBinding | T2/T2 | candidate: file-format | none |
| schema:AnimSrcIkTargetBinding | T2/T2 | candidate: file-format | none |
| schema:AnimSrcJiggleConstraintLinear | T2/T2 | candidate: file-format | none |

66 more: wb_census find with module=AnimEditor kind=schema-class.

### schema-key (422)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:AnimEventTable.EventNames | T2/T2 | candidate: file-format | none |
| schema:AnimSetInstanceSource.IkPose | T2/T2 | candidate: file-format | none |
| schema:AnimSetInstanceSource.Lines | T2/T2 | candidate: file-format | none |
| schema:AnimSetInstanceSource.ParentTemplates | T2/T2 | candidate: file-format | none |
| schema:AnimSetInstanceSource.RBF | T2/T2 | candidate: file-format | none |
| schema:AnimSetInstanceSource.Template | T2/T2 | candidate: file-format | none |
| schema:AnimSetInstanceSource_Line.Resource | T2/T2 | candidate: file-format | none |
| schema:AnimSetTemplateSource.Groups | T2/T2 | candidate: file-format | none |
| schema:AnimSetTemplateSource_AnimationGroup.Animations | T2/T2 | candidate: file-format | none |
| schema:AnimSetTemplateSource_AnimationGroup.Columns | T2/T2 | candidate: file-format | none |
| schema:AnimSetTemplateSource_AnimationGroup.Name | T2/T2 | candidate: file-format | none |
| schema:AnimSrcConstraintParent.AffectedBone | T2/T2 | candidate: file-format | none |
| schema:AnimSrcConstraintParent.TargetBone | T2/T2 | candidate: file-format | none |
| schema:AnimSrcDebugCtlCmd.Binding | T2/T2 | candidate: file-format | none |
| schema:AnimSrcDebugCtlCmd.FloatVal | T2/T2 | candidate: file-format | none |
| schema:AnimSrcDebugCtlCmd.IntVal | T2/T2 | candidate: file-format | none |
| schema:AnimSrcDebugCtlGroup.DebugControls | T2/T2 | candidate: file-format | none |
| schema:AnimSrcDebugCtlVar.Binding | T2/T2 | candidate: file-format | none |
| schema:AnimSrcDebugCtlVar.BoolVal | T2/T2 | candidate: file-format | none |
| schema:AnimSrcDebugCtlVar.FloatVal | T2/T2 | candidate: file-format | none |
| schema:AnimSrcDebugCtlVar.IntVal | T2/T2 | candidate: file-format | none |
| schema:AnimSrcEvent.Condition | T2/T2 | candidate: file-format | none |
| schema:AnimSrcEvent.InitOnly | T2/T2 | candidate: file-format | none |
| schema:AnimSrcEvent.Name | T2/T2 | candidate: file-format | none |
| schema:AnimSrcEvent.Once | T2/T2 | candidate: file-format | none |
| schema:AnimSrcEvent.UserInt | T2/T2 | candidate: file-format | none |
| schema:AnimSrcEvent.UserString | T2/T2 | candidate: file-format | none |
| schema:AnimSrcEventGeneric.Condition | T2/T2 | candidate: file-format | none |
| schema:AnimSrcEventGeneric.InitOnly | T2/T2 | candidate: file-format | none |
| schema:AnimSrcEventGeneric.MainPathOnly | T2/T2 | candidate: file-format | none |
| schema:AnimSrcEventGeneric.Name | T2/T2 | candidate: file-format | none |
| schema:AnimSrcEventGeneric.Once | T2/T2 | candidate: file-format | none |
| schema:AnimSrcEventGeneric.UserInt | T2/T2 | candidate: file-format | none |
| schema:AnimSrcEventGeneric.UserString | T2/T2 | candidate: file-format | none |
| schema:AnimSrcGCT.BoneMasks | T2/T2 | candidate: file-format | none |
| schema:AnimSrcGCT.Commands | T2/T2 | candidate: file-format | none |
| schema:AnimSrcGCT.CurveLibraries | T2/T2 | candidate: file-format | none |
| schema:AnimSrcGCT.Curves | T1/T2 | candidate: file-format | none |
| schema:AnimSrcGCT.GlobalTags | T2/T2 | candidate: file-format | none |
| schema:AnimSrcGCT.IkChains | T2/T2 | candidate: file-format | none |

382 more: wb_census find with module=AnimEditor kind=schema-key.

### setting-key (35)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| setting:Animation Editor%2FFileBrowser%2FResourceBrowser/ascendingOrder | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FFileBrowser%2FResourceBrowser/currentItem | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FFileBrowser%2FResourceBrowser/expandAll | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FFileBrowser%2FResourceBrowser/favorites | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FFileBrowser%2FResourceBrowser/gridZoom | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FFileBrowser%2FResourceBrowser/listModeEnabled | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FFileBrowser%2FResourceBrowser/orientation | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FFileBrowser%2FResourceBrowser/recursiveMode | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FFileBrowser%2FResourceBrowser/root | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FFileBrowser%2FResourceBrowser/runtimeFilterOn | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FFileBrowser%2FResourceBrowser/showFavorites | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FFileBrowser%2FResourceBrowser/showFavoritesFullPath | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FFileBrowser%2FResourceBrowser/sortFavorites | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FFileBrowser%2FResourceBrowser/sortingMethod | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FFileBrowser%2FResourceBrowser/splitterState | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FFileBrowser%2FResourceBrowser/splitterState2 | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FFileBrowser%2FResourceBrowser/tagsMatchAll | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FFileBrowser%2FResourceBrowser/textElideMode | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FLogWidget%2FLogView/ContextMask | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FLogWidget%2FLogView/LogLevel_1 | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FLogWidget%2FLogView/LogLevel_16 | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FLogWidget%2FLogView/LogLevel_2 | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FLogWidget%2FLogView/LogLevel_32 | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FLogWidget%2FLogView/LogLevel_4 | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FLogWidget%2FLogView/LogLevel_64 | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FLogWidget%2FLogView/LogLevel_8 | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FLogWidget/errorsOnly | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FLogWidget/fontSize | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FLogWidget/infosOnly | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FLogWidget/showOnlyMatchingLinesAtSearch | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FLogWidget/warningsOnly | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FPerspectives%2Fdefault/Geometry | T0/T3 | candidate: file-format | none |
| setting:Animation Editor%2FPerspectives%2Fdefault/State | T0/T3 | candidate: file-format | none |
| setting:Animation Editor/currentPerspective | T0/T3 | candidate: file-format | none |
| setting:Animation Editor/legacyOptionsLoaded | T0/T3 | candidate: file-format | none |

### shortcut (18)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AnimEditor/shortcut/Animation Editor/Locate file | T2/T2 | candidate: gui-automation | none |
| ui:AnimEditor/shortcut/Animation Editor/New Workspace | T2/T2 | candidate: gui-automation | none |
| ui:AnimEditor/shortcut/Animation Editor/Open Workspace | T2/T2 | candidate: gui-automation | none |
| ui:AnimEditor/shortcut/Animation Editor/Play | T2/T2 | candidate: gui-automation | none |
| ui:AnimEditor/shortcut/Animation Editor/Save Workspace | T2/T2 | candidate: gui-automation | none |
| ui:AnimEditor/shortcut/Animation Editor/Show Anim Sets | T2/T2 | candidate: gui-automation | none |
| ui:AnimEditor/shortcut/Animation Editor/Show Controls | T2/T2 | candidate: gui-automation | none |
| ui:AnimEditor/shortcut/Animation Editor/Show Debug Controls | T2/T2 | candidate: gui-automation | none |
| ui:AnimEditor/shortcut/Animation Editor/Show Errors | T2/T2 | candidate: gui-automation | none |
| ui:AnimEditor/shortcut/Animation Editor/Show Graph Window | T2/T2 | candidate: gui-automation | none |
| ui:AnimEditor/shortcut/Animation Editor/Show Properties | T2/T2 | candidate: gui-automation | none |
| ui:AnimEditor/shortcut/Animation Editor/Show Workspace | T2/T2 | candidate: gui-automation | none |
| ui:AnimEditor/shortcut/Top Bar/copy selection | T1/T2 | candidate: gui-automation | none |
| ui:AnimEditor/shortcut/Top Bar/create new workspace | T1/T2 | candidate: gui-automation | none |
| ui:AnimEditor/shortcut/Top Bar/cut selection | T1/T2 | candidate: gui-automation | none |
| ui:AnimEditor/shortcut/Top Bar/open workspace | T1/T2 | candidate: gui-automation | none |
| ui:AnimEditor/shortcut/Top Bar/paste | T1/T2 | candidate: gui-automation | none |
| ui:AnimEditor/shortcut/Top Bar/save workspace | T1/T2 | candidate: gui-automation | none |

### status-item (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AnimEditor/status-item/@QStatusBar.1/Version 1.8.0.13 (production) | T2/T2 | candidate: gui-automation | none |

### tab (20)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AnimEditor/tab/@QMainWindowTabBar/Animation Sets | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/tab/@QMainWindowTabBar/Channel Curves | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/tab/@QMainWindowTabBar/Controls | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/tab/@QMainWindowTabBar/Errors | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/tab/@QMainWindowTabBar/File Browser | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/tab/@QMainWindowTabBar/Graph | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/tab/@QMainWindowTabBar/Live Debug | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/tab/@QMainWindowTabBar/Log Console | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/tab/@QMainWindowTabBar/Properties | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/tab/@QMainWindowTabBar/Workspace | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/tab/Controls/Controls | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/tab/Controls/Errors | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/tab/Controls/File Browser | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/tab/Controls/Live Debug | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/tab/Controls/Properties | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/tab/Graph/Channel Curves | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/tab/Graph/Graph | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/tab/Graph/Log Console | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/tab/Workspace/Animation Sets | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/tab/Workspace/Workspace | T1/T3 | candidate: gui-automation | none |

### toolbar (7)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AnimEditor/toolbar/#mainToolBar | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/toolbar/@QToolBar.1 | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/toolbar/@QToolBar.2 | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/toolbar/Anim Editor Preview/Top Bar | T1/T3 | candidate: gui-automation | none |
| ui:AnimEditor/toolbar/Error button | T0/T3 | candidate: gui-automation | none |
| ui:AnimEditor/toolbar/Stop | T0/T3 | candidate: execute-action | none |
| ui:AnimEditor/toolbar/Top Bar | T1/T3 | candidate: gui-automation | none |

### toolbar-button (52)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AnimEditor/toolbar-button/@QToolBar.1/Change FOV | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/@QToolBar.1/Colliders | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/@QToolBar.1/LOD 0 | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/@QToolBar.1/LOD 1 | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/@QToolBar.1/LOD 2 | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/@QToolBar.1/LOD 3 | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/@QToolBar.1/LOD 4 | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/@QToolBar.1/LOD 5 | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/@QToolBar.1/LOD 6 | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/@QToolBar.1/Move | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/@QToolBar.1/Rotate | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/@QToolBar.1/Show Preview Options | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/@QToolBar.1/Show auxiliary output | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/@QToolBar.1/Show bone hierarchy | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/@QToolBar.1/Show bones | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/@QToolBar.1/Show gizmos | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/@QToolBar.1/Show grid | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/@QToolBar.1/Show trajectory | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/@QToolBar.2/Options | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/@QToolBar.2/Overlay | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/@QToolBar.2/Shading | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/@QToolBar.2/View | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/Anim Editor Preview/Top Bar/move (Inverted Kinematics) | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/Anim Editor Preview/Top Bar/rotate (Inverted Kinematics) | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/Anim Editor Preview/Top Bar/select an animation from folder | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/Anim Editor Preview/Top Bar/select which animation LOD is played 0 being least detailed and 3 most detailed | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/Anim Editor Preview/Top Bar/set the field of view for the preview camera | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/Anim Editor Preview/Top Bar/show%2Fhide IK targets | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/Anim Editor Preview/Top Bar/show%2Fhide all bones | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/Anim Editor Preview/Top Bar/show%2Fhide colliders | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/Anim Editor Preview/Top Bar/show%2Fhide specific bones from a hierarchical list containing all bones | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/Anim Editor Preview/Top Bar/show%2Fhide the Evaluation Information | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/Anim Editor Preview/Top Bar/show%2Fhide the floor grid | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/Anim Editor Preview/Top Bar/switch between first person and third person animation | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/Top Bar/copy selection | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/Top Bar/create new workspace | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/Top Bar/cut selection | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/Top Bar/error button | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/Top Bar/save changes in animation files but not in workspace | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:AnimEditor/toolbar-button/Top Bar/stop animation playing | T1/T5 | candidate: execute-action, gui-automation | none |

12 more: wb_census find with module=AnimEditor kind=toolbar-button.

### window (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:AnimEditor/window/#AnimEditor | T1/T3 | candidate: gui-automation | none |

## Below target (540)

- T0 to T2: 113
- T0 to T3: 94
- T0 to T5: 107
- T1 to T2: 7
- T1 to T3: 40
- T1 to T5: 46
- T2 to T3: 20
- T2 to T5: 112
- T3 to T5: 1

| id | tier | path |
| --- | --- | --- |
| api:AnimSrcIkBinding | T0/T2 | candidate: file-format |
| api:AnimSrcNodePrediction | T0/T2 | candidate: file-format |
| api:AnimSrcNodeQueueItem | T0/T2 | candidate: file-format |
| api:AnimSrcNodeSwitchItem | T0/T2 | candidate: file-format |
| api:AnimSrcNodeTransition | T0/T2 | candidate: file-format |
| api:AnimSrcNodeVarUpdateItem | T0/T2 | candidate: file-format |
| api:AnimSrcTransformOffset | T0/T2 | candidate: file-format |
| api:Constraints | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeAttachment (wiki: Attachment) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeAuxOut (wiki: (not in wiki)) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeBindPose (wiki: Bind Pose) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeBlend (wiki: Blend) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeBlendN (wiki: Blend N) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeBlendT (wiki: Blend T) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeBlendTAdd (wiki: Blend T Add) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeBlendTW (wiki: Blend TW) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeBufferSave (wiki: Buffer Save) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeBufferUse (wiki: Buffer Use) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeConstraint (wiki: Constraint) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeEvent (wiki: Event) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeFilter (wiki: Filter) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeFuncBegin (wiki: Function Begin) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeFuncCall (wiki: Function Call) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeFuncEnd (wiki: Function End) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeGroupSelect (wiki: Group Select) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeIK2 (wiki: IK2) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeIK2Target (wiki: IK2 Target) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeIKRot (wiki: IK Rotation) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeJiggle (wiki: (not in wiki)) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeLastPose (wiki: (not in wiki)) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeParentPose (wiki: (not in wiki)) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodePendulum (wiki: (not in wiki)) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodePose (wiki: Pose) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodePose2 (wiki: Pose 2) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodePoseDrivenRbf (wiki: (not in wiki)) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodePoseRbf (wiki: RBF (probable match)) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeProcTransform (wiki: Procedural) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeQueue (wiki: Queue) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeSleep (wiki: Sleep) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeSource (wiki: Source) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeSourceInLoopOut (wiki: Source InLoopOut) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeSourceSync (wiki: Source Sync) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeState (wiki: State) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeStateMachine (wiki: State Machine) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeSwitch (wiki: Switch) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeTag (wiki: Tag) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeTimeScale (wiki: Time Scale) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeVarReset (wiki: Var Reset) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeVarSet (wiki: Var Set) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeVarUpdate (wiki: Var Update) | T0/T2 | candidate: file-format |
| api:class/AnimSrcNodeWeaponIk (wiki: Weapon IK) | T0/T2 | candidate: file-format |
| api:class/IK Lock (wiki) (wiki: IK Lock) | T0/T2 | candidate: file-format |
| api:class/IK solvers | T0/T2 | candidate: file-format |
| api:class/IK2 Plane (wiki) (wiki: IK2 Plane) | T0/T2 | candidate: file-format |
| api:class/Memory (wiki) (wiki: Memory) | T0/T2 | candidate: file-format |
| api:class/Primitive colliders | T0/T2 | candidate: file-format |
| api:class/VarSet items | T0/T2 | candidate: file-format |
| api:enum/Enum BlendFn | T0/T2 | candidate: file-format |
| api:enum/Enum EnqueueMethod | T0/T2 | candidate: file-format |
| api:enum/Enum IkTargets blending | T0/T2 | candidate: file-format |

480 more: wb_census find with module=AnimEditor.

## Dispositions (72)

| id | kind | why | evidence |
| --- | --- | --- | --- |
| api:AnimSrcIkBinding | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:AnimSrcNodePrediction | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:AnimSrcNodeQueueItem | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:AnimSrcNodeSwitchItem | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:AnimSrcNodeTransition | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:AnimSrcNodeVarUpdateItem | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:AnimSrcTransformOffset | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:Constraints | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeAttachment (wiki: Attachment) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeAuxOut (wiki: (not in wiki)) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/AnimSrcNodeBindPose (wiki: Bind Pose) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeBlend (wiki: Blend) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeBlendN (wiki: Blend N) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeBlendT (wiki: Blend T) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeBlendTAdd (wiki: Blend T Add) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeBlendTW (wiki: Blend TW) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeBufferSave (wiki: Buffer Save) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeBufferUse (wiki: Buffer Use) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeConstraint (wiki: Constraint) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeEvent (wiki: Event) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeFilter (wiki: Filter) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/AnimSrcNodeFuncBegin (wiki: Function Begin) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeFuncCall (wiki: Function Call) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeFuncEnd (wiki: Function End) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeGroupSelect (wiki: Group Select) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeIK2 (wiki: IK2) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeIK2Target (wiki: IK2 Target) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeIKRot (wiki: IK Rotation) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeJiggle (wiki: (not in wiki)) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeLastPose (wiki: (not in wiki)) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/AnimSrcNodeParentPose (wiki: (not in wiki)) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/AnimSrcNodePendulum (wiki: (not in wiki)) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/AnimSrcNodePose (wiki: Pose) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodePose2 (wiki: Pose 2) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodePoseDrivenRbf (wiki: (not in wiki)) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/AnimSrcNodePoseRbf (wiki: RBF (probable match)) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/AnimSrcNodeProcTransform (wiki: Procedural) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeQueue (wiki: Queue) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeSleep (wiki: Sleep) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeSource (wiki: Source) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeSourceInLoopOut (wiki: Source InLoopOut) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeSourceSync (wiki: Source Sync) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeState (wiki: State) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeStateMachine (wiki: State Machine) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeSwitch (wiki: Switch) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeTag (wiki: Tag) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/AnimSrcNodeTimeScale (wiki: Time Scale) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeVarReset (wiki: Var Reset) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/AnimSrcNodeVarSet (wiki: Var Set) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeVarUpdate (wiki: Var Update) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/AnimSrcNodeWeaponIk (wiki: Weapon IK) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/IK Lock (wiki) (wiki: IK Lock) | absent-in-build | G3 frontier: mirrors the recon_resolution absent-in-build already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/IK solvers | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/IK2 Plane (wiki) (wiki: IK2 Plane) | absent-in-build | G3 frontier: mirrors the recon_resolution absent-in-build already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Memory (wiki) (wiki: Memory) | absent-in-build | G3 frontier: mirrors the recon_resolution absent-in-build already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Primitive colliders | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/VarSet items | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:enum/Enum BlendFn | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:enum/Enum EnqueueMethod | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:enum/Enum IkTargets blending | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:enum/Enum Looptype | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:enum/Enum Optimization | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:enum/Enum TimeStorage | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| file:file-type/.adbg animation debug recording | blocked | The executable holds the .adbg extension as a string and no static source describes it; which editor opens or writes it is P-FILETYPES-EXE. | EV-s001-003 |
| file:file-type/.apr export profile | blocked | Only the recon names the .apr export profile (no measured row, no executable string); which editor, if any, opens or writes it is P-FILETYPES-EXE. | EV-s001-003 |
| file:file-type/.fbxa animation source | blocked | The executable holds the .fbxa extension as a string and no static source describes it; which editor opens or writes it is P-FILETYPES-EXE. | EV-s001-003 |
| ui:AnimEditor/menu-item/Exit | duplicate-of | duplicate-of:ui:AnimEditor/menu-item/File/Exit (proposal docs/v2/inbox/w4/remainder.jsonl; ui:AnimEditor/menu-item/File/Exit at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| ui:AnimEditor/menu-item/File/Exit | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:AnimEditor/menu-item/Tools/Reload Animations | blocked | blocked:P-W4-27 (Tools menu action: joins the wb_module.action allow-list only if the probe shows no dialog) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| ui:AnimEditor/menu-item/Tools/Repair Duplicate Channels in TXA files... | blocked | blocked:P-W4-27 (Tools menu action: joins the wb_module.action allow-list only if the probe shows no dialog) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| ui:AnimEditor/menu-item/Tools/Verify Animations... | blocked | blocked:P-W4-27 (Tools menu action: joins the wb_module.action allow-list only if the probe shows no dialog) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| ui:AnimEditor/menu-item/Window/Reset Default Layouts | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
