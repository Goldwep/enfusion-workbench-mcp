# Census: ProcAnimEditor

279 rows (7 aggregate excluded).

## What it is

Module ProcAnimEditor: api 38, cli 2, file 3, link 2, net 3, plugin 1, schema 65, ui 165. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- class ProcAnimEditor (api:ProcAnimEditor)
- class PAP compiled block (api:class/PAP compiled block): compiled ProcAnimCompiledClass { visited{} ops{ ProcAnimCompiledOp{ data{...} } } version argsize } in 47/47 files
- class PAP connections (api:class/PAP connections): IOPConnectionClass > ConnectionsClass > ConnectionClass (id, port), outs lists (1,090 connections)
- class PAP node Bone (BoneClass) (api:class/PAP node Bone (BoneClass)): Bone reference (bone, version)
- class PAP node Constants (api:class/PAP node Constants): Key/value constants (classes ProcAnimConstants, IOPConstantsValueClass); unused in vanilla
- class PAP node RotationBreak (api:class/PAP node RotationBreak): Split rotation
- class PAP node RotationMake (api:class/PAP node RotationMake): Build rotation from X/Y/Z inputs
- class PAP node RotationSet (api:class/PAP node RotationSet): Apply rotation to bone; UpdateCollider
- class PAP node Signal (SignalClass) (api:class/PAP node Signal (SignalClass)): Reference to a .siga (res), with inputsport/outputsport/inputvalues(min/max)
- class PAP node TranslateBreak (api:class/PAP node TranslateBreak): Split translation
- class PAP node TranslateMake (api:class/PAP node TranslateMake): Build translation vector
- class PAP node TranslateSet (api:class/PAP node TranslateSet): Apply translation
- ... 49 more

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| api | 37 | 0 | 1 | 0 | 0 | 0 | 38 |
| cli | 2 | 0 | 0 | 0 | 0 | 0 | 2 |
| file | 1 | 0 | 2 | 0 | 0 | 0 | 3 |
| link | 0 | 1 | 1 | 0 | 0 | 0 | 2 |
| net | 3 | 0 | 0 | 0 | 0 | 0 | 3 |
| plugin | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| schema | 0 | 0 | 65 | 0 | 0 | 0 | 65 |
| ui | 62 | 7 | 90 | 1 | 0 | 5 | 165 |

## By kind

- class: 25
- cli-switch: 2
- control: 40
- dock: 6
- file-type: 3
- link-format: 2
- menu: 7
- menu-item: 28
- method: 13
- module: 1
- net-handler: 3
- option: 1
- panel: 15
- plugin: 1
- property-group: 2
- region: 20
- schema-class: 10
- schema-key: 55
- shortcut: 20
- status-item: 1
- tool: 7
- toolbar: 2
- toolbar-button: 14
- window: 1

## By risk

- destructive: 3
- mutating: 121
- safe: 155

## Rows by kind

### class (25)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:ProcAnimEditor | T2/T2 | candidate: none-known | none |
| api:class/PAP compiled block | T0/T2 | candidate: none-known | none |
| api:class/PAP connections | T0/T2 | candidate: file-format | none |
| api:class/PAP node Bone (BoneClass) | T0/T2 | candidate: file-format | none |
| api:class/PAP node Constants | T0/T2 | candidate: file-format | none |
| api:class/PAP node RotationBreak | T0/T2 | candidate: file-format | none |
| api:class/PAP node RotationMake | T0/T2 | candidate: file-format | none |
| api:class/PAP node RotationSet | T0/T2 | candidate: file-format | none |
| api:class/PAP node Signal (SignalClass) | T0/T2 | candidate: file-format | none |
| api:class/PAP node TranslateBreak | T0/T2 | candidate: file-format | none |
| api:class/PAP node TranslateMake | T0/T2 | candidate: file-format | none |
| api:class/PAP node TranslateSet | T0/T2 | candidate: file-format | none |
| api:class/SIGA Generator (IOPInputGeneratorClass) | T0/T2 | candidate: file-format | none |
| api:class/SIGA Input (IOPItemInputClass) | T0/T2 | candidate: file-format | none |
| api:class/SIGA Output (IOPItemOutputClass) | T0/T2 | candidate: file-format | none |
| api:class/SIGA Random (IOPInputRandomClass) | T0/T2 | candidate: file-format | none |
| api:class/SIGA Value (IOPInputValueClass) | T0/T2 | candidate: file-format | none |
| api:class/SIGA compiled block | T0/T2 | candidate: none-known | none |
| api:class/SIGA inputs LFO, Time, Variable, CurveModulator, SquareModulator | T0/T2 | candidate: file-format | none |
| api:class/SIGA math ops Sum, Sub, Mul, Div, Min, Max, Pow, Remainder, Abs, Exp, Ln, Log2, Log10 | T0/T2 | candidate: file-format | none |
| api:class/SIGA ops Average, Smoother, Interpolate, Env, Convertor | T0/T2 | candidate: file-format | none |
| api:class/SIGA ops Condition, Filter, Delta, Modulo | T0/T2 | candidate: file-format | none |
| api:class/SIGA ops Db2Gain, Gain2Db, St2Gain, Gain2St, Freq2Oc | T0/T2 | candidate: file-format | none |
| api:class/SIGA ops Floor, Ceil, Round, Clamp, ClampMin, ClampMax | T0/T2 | candidate: file-format | none |
| api:class/SIGA ops Sin, Cos, Tan, ASin, ACos, ATan | T0/T2 | candidate: file-format | none |

### cli-switch (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| cli:cli-switch/CLI module launch | T0/T5 | candidate: cli | none |
| cli:cli-switch/enfusion:%2F%2F links | T0/T5 | candidate: cli | none |

### control (40)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ProcAnimEditor/control/#Maximize-Restore | T2/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/#Minimize-Restore | T2/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/#filterButton | T0/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/#navigateBackward | T0/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/#navigateForward | T0/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/#navigateUp | T0/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/#projectTree | T0/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/Close | T2/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/Select model | T0/T5 | candidate: file-format | none |
| ui:ProcAnimEditor/control/browserDockWidget/Close | T2/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/browserDockWidget/Float | T2/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/browserDockWidget/browserContents/93 items | T2/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/browserDockWidget/browserContents/@QPushButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/browserDockWidget/browserContents/@ResourceListView.1 | T0/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/browserDockWidget/browserContents/@ResourceTreeView.1 | T0/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/browserDockWidget/browserContents/@WBEditBox.1 | T0/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/browserDockWidget/browserContents/@WBEditBox.1/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/browserDockWidget/browserContents/Create | T2/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/browserDockWidget/browserContents/Import | T2/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/consoleDockWidget/Close | T2/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/consoleDockWidget/Float | T2/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/consoleDockWidget/logDockContents/@QPushButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/consoleDockWidget/logDockContents/@QPushButton.2 | T0/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/consoleDockWidget/logDockContents/@QToolButton.1 | T2/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/consoleDockWidget/logDockContents/@QToolButton.2 | T2/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/consoleDockWidget/logDockContents/@QToolButton.3 | T2/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/consoleDockWidget/logDockContents/@WBEditBox.1 | T0/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/consoleDockWidget/logDockContents/@WBEditBox.1/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/consoleDockWidget/logDockContents/Clear Console | T2/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/contentDockWidget/Close | T2/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/contentDockWidget/Float | T2/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/detailDockWidget/Close | T2/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/detailDockWidget/Float | T2/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/signalsDockWidget/@QPushButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/signalsDockWidget/@WBEditBox.1 | T0/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/signalsDockWidget/@WBEditBox.1/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/signalsDockWidget/Close | T2/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/signalsDockWidget/Float | T2/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/viewDockWidget/Close | T2/T5 | candidate: gui-automation | none |
| ui:ProcAnimEditor/control/viewDockWidget/Float | T2/T5 | candidate: gui-automation | none |

### dock (6)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ProcAnimEditor/dock/#browserDockWidget | T2/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/dock/#consoleDockWidget | T2/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/dock/#contentDockWidget | T2/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/dock/#detailDockWidget | T2/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/dock/#signalsDockWidget | T2/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/dock/#viewDockWidget | T2/T3 | candidate: gui-automation | none |

### file-type (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| file:.pap | T2/T3 | candidate: file-format | [procanim.create](../tools/procanim.md) drive, [procanim.edit](../tools/procanim.md) drive, [procanim.inspect](../tools/procanim.md) read, [procanim.nodes](../tools/procanim.md) read, [procanim.validate](../tools/procanim.md) read |
| file:.siga | T2/T3 | candidate: file-format | none |
| file:file-type/.siga file | T0/T3 | candidate: file-format | none |

### link-format (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| link:enfusion://ProcAnimEditor | T1/T5 | candidate: cli | [wb_link.build](../tools/wb_link.md) read, [wb_link.open](../tools/wb_link.md) drive, [wb_link.parse](../tools/wb_link.md) read |
| link:https://community.bistudio.com/wiki/Arma_Reforger:Procedural_Animation_Editor | T2/T5 | candidate: file-format | none |

### menu (7)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ProcAnimEditor/menu/Debug | T2/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/menu/Edit | T2/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/menu/File | T2/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/menu/File/New | T2/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/menu/Help | T2/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/menu/Window | T2/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/menu/Window/Layout | T2/T3 | candidate: gui-automation | none |

### menu-item (28)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ProcAnimEditor/menu-item/Create Group | T0/T5 | candidate: file-format | none |
| ui:ProcAnimEditor/menu-item/Debug/Start Debugging | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/menu-item/Edit/Copy | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/menu-item/Edit/Create Group | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/menu-item/Edit/Cut | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/menu-item/Edit/Paste | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/menu-item/Edit/Redo | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/menu-item/Edit/Undo | T3/T5 | candidate: execute-action, gui-automation | [wb_module.action](../tools/wb_module.md) drive |
| ui:ProcAnimEditor/menu-item/File/Close | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/menu-item/File/Exit | T2/T2 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/menu-item/File/New/Project... | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/menu-item/File/New/Signal... | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/menu-item/File/Open | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/menu-item/File/Save | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/menu-item/File/Save All | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/menu-item/File/Save As | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/menu-item/Help/View Help | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/menu-item/New DSP... | T0/T5 | candidate: execute-action | none |
| ui:ProcAnimEditor/menu-item/Start Debugging | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/menu-item/Window/Item Detail | T5/T5 | execute-action | [wb_module.action](../tools/wb_module.md) drive |
| ui:ProcAnimEditor/menu-item/Window/Item Explorer | T5/T5 | execute-action | [wb_module.action](../tools/wb_module.md) drive |
| ui:ProcAnimEditor/menu-item/Window/Layout/Create New Layout | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/menu-item/Window/Layout/edit | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/menu-item/Window/Log Console | T5/T5 | execute-action | [wb_module.action](../tools/wb_module.md) drive |
| ui:ProcAnimEditor/menu-item/Window/Manage Layouts | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/menu-item/Window/Reset Default Layouts | T2/T2 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/menu-item/Window/Resource Browser | T5/T5 | execute-action | [wb_module.action](../tools/wb_module.md) drive |
| ui:ProcAnimEditor/menu-item/Window/View | T5/T5 | execute-action | [wb_module.action](../tools/wb_module.md) drive |

### method (13)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:method/Module class AnimEditor | T0/T5 | candidate: net-api-handler | none |
| api:method/Module class BehaviorEditor | T0/T5 | candidate: net-api-handler | none |
| api:method/Module class ProcAnimEditor | T0/T5 | candidate: net-api-handler | none |
| api:method/WBModuleDef.Close() | T0/T5 | candidate: net-api-handler | none |
| api:method/WBModuleDef.ExecuteAction(array menuPath, bool bKeepFocus=true) | T0/T5 | candidate: execute-action | none |
| api:method/WBModuleDef.GetCmdLine(string name, out string value) | T0/T5 | candidate: net-api-handler, plugin-run | none |
| api:method/WBModuleDef.GetContainer(int index=0) | T0/T5 | candidate: net-api-handler | none |
| api:method/WBModuleDef.GetNumContainers() | T0/T5 | candidate: net-api-handler | none |
| api:method/WBModuleDef.GetPlugin(typename pluginType) | T0/T5 | candidate: plugin-run | none |
| api:method/WBModuleDef.Save() | T0/T5 | candidate: net-api-handler | none |
| api:method/WBModuleDef.SetOpenedResource(string filename) | T0/T5 | candidate: net-api-handler | none |
| api:method/Workbench.OpenResource(string filename) | T0/T5 | candidate: net-api-handler | none |
| api:method/pointer.ToString() | T0/T5 | candidate: net-api-handler | none |

### module (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ProcAnimEditor/module/ProcAnimEditor | T1/T5 | candidate: builtin-net-handler, net-api-handler | [wb_module.info](../tools/wb_module.md) drive |

### net-handler (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| net:net-handler/Built-in APIFunc BringModuleWindowToFront | T0/T5 | candidate: builtin-net-handler | none |
| net:net-handler/Built-in APIFunc EvaluateScript | T0/T5 | candidate: builtin-net-handler | none |
| net:net-handler/Built-in APIFunc OpenResource | T0/T5 | candidate: builtin-net-handler | none |

### option (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ProcAnimEditor/option/Shortcut categories | T0/T5 | candidate: gui-automation | none |

### panel (15)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ProcAnimEditor/panel/#browserContents | T0/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/panel/#contentContents | T0/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/panel/#dockDetailContents | T0/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/panel/#dockViewContents | T0/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/panel/#logDockContents | T0/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/panel/#qt_tabwidget_tabbar | T0/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/panel/#statusBar | T0/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/panel/Console | T1/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/panel/Item Explorer | T0/T3 | candidate: file-format | none |
| ui:ProcAnimEditor/panel/Item detail | T1/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/panel/Log Console | T0/T3 | candidate: file-format | none |
| ui:ProcAnimEditor/panel/Main window | T1/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/panel/Nodes palette | T1/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/panel/Resource browser | T1/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/panel/View | T1/T3 | candidate: gui-automation | none |

### plugin (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:plugin/Workbench plugins for these modules | T0/T5 | candidate: plugin-run | none |

### property-group (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ProcAnimEditor/property-group/#SignalSimPropGrid | T0/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/property-group/ProcAnimComponent setup | T0/T3 | candidate: file-format, net-api-handler | none |

### region (20)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ProcAnimEditor/region/#SystemMenuBar | T0/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/region/#centralwidget | T0/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/region/#menubar | T0/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/region/#page_2 | T0/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/region/#qt_scrollarea_hcontainer | T0/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/region/#qt_scrollarea_vcontainer | T0/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/region/#qt_splithandle_gridPanel | T0/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/region/#signalsDockContent | T0/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/region/@SceneRenderWindow.1 | T0/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/region/@TitleBar.1 | T0/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/region/browserDockWidget/browserContents/@BreadcrumbTrailWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/region/consoleDockWidget/logDockContents/@QScrollBar.1 | T0/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/region/consoleDockWidget/logDockContents/@QScrollBar.2 | T0/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/region/consoleDockWidget/logDockContents/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/region/statusBar/@QSizeGrip.1 | T0/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/region/toolBar/@QToolBarSeparator.1 | T0/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/region/viewDockWidget/dockViewContents/@QToolBar.1/@QToolBarSeparator.1 | T0/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/region/viewDockWidget/dockViewContents/@QToolBar.1/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/region/viewDockWidget/dockViewContents/@QToolBar.1/@QWidget.2 | T0/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/region/viewDockWidget/dockViewContents/@SceneRenderWindow.1 | T0/T2 | candidate: gui-automation | none |

### schema-class (10)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:BoneClass | T2/T2 | candidate: file-format | none |
| schema:IOPItemOpATanClass | T2/T2 | candidate: file-format | none |
| schema:ProcAnimCompiledClass | T2/T2 | candidate: file-format | none |
| schema:ProcAnimCompiledOp | T2/T2 | candidate: file-format | none |
| schema:ProcAnimProjectClass | T2/T2 | candidate: file-format | none |
| schema:ProcAnimSignalResClass | T2/T2 | candidate: file-format | none |
| schema:RotationMakeClass | T2/T2 | candidate: file-format | none |
| schema:RotationSetClass | T2/T2 | candidate: file-format | none |
| schema:TranslateMakeClass | T2/T2 | candidate: file-format | none |
| schema:TranslateSetClass | T2/T2 | candidate: file-format | none |

### schema-key (55)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:BoneClass.bone | T2/T2 | candidate: file-format | none |
| schema:BoneClass.comment | T2/T2 | candidate: file-format | none |
| schema:BoneClass.ctl | T2/T2 | candidate: file-format | none |
| schema:BoneClass.id | T2/T2 | candidate: file-format | none |
| schema:BoneClass.name | T2/T2 | candidate: file-format | none |
| schema:BoneClass.outs | T2/T2 | candidate: file-format | none |
| schema:BoneClass.tl | T2/T2 | candidate: file-format | none |
| schema:BoneClass.updatebbox | T2/T2 | candidate: file-format | none |
| schema:BoneClass.version | T2/T2 | candidate: file-format | none |
| schema:IOPItemOpATanClass.children | T2/T2 | candidate: file-format | none |
| schema:IOPItemOpATanClass.id | T2/T2 | candidate: file-format | none |
| schema:IOPItemOpATanClass.inputs | T2/T2 | candidate: file-format | none |
| schema:IOPItemOpATanClass.name | T2/T2 | candidate: file-format | none |
| schema:IOPItemOpATanClass.tl | T2/T2 | candidate: file-format | none |
| schema:ProcAnimCompiledClass.argsize | T2/T2 | candidate: file-format | none |
| schema:ProcAnimCompiledClass.ops | T2/T2 | candidate: file-format | none |
| schema:ProcAnimCompiledClass.order | T2/T2 | candidate: file-format | none |
| schema:ProcAnimCompiledClass.version | T2/T2 | candidate: file-format | none |
| schema:ProcAnimCompiledClass.visited | T2/T2 | candidate: file-format | none |
| schema:ProcAnimCompiledOp.data | T2/T2 | candidate: file-format | none |
| schema:ProcAnimProjectClass.compiled | T2/T2 | candidate: file-format | none |
| schema:ProcAnimProjectClass.funcs | T2/T2 | candidate: file-format | none |
| schema:ProcAnimProjectClass.groups | T2/T2 | candidate: file-format | none |
| schema:ProcAnimProjectClass.model | T2/T2 | candidate: file-format | none |
| schema:ProcAnimProjectClass.signals | T2/T2 | candidate: file-format | none |
| schema:ProcAnimProjectClass.version | T2/T2 | candidate: file-format | none |
| schema:ProcAnimSignalResClass.Inputs | T2/T2 | candidate: file-format | none |
| schema:ProcAnimSignalResClass.Ops | T2/T2 | candidate: file-format | none |
| schema:ProcAnimSignalResClass.Outputs | T2/T2 | candidate: file-format | none |
| schema:ProcAnimSignalResClass.compiled | T2/T2 | candidate: file-format | none |
| schema:ProcAnimSignalResClass.groups | T2/T2 | candidate: file-format | none |
| schema:RotationMakeClass.comment | T2/T2 | candidate: file-format | none |
| schema:RotationMakeClass.ctl | T2/T2 | candidate: file-format | none |
| schema:RotationMakeClass.id | T2/T2 | candidate: file-format | none |
| schema:RotationMakeClass.iops | T2/T2 | candidate: file-format | none |
| schema:RotationMakeClass.name | T2/T2 | candidate: file-format | none |
| schema:RotationMakeClass.outs | T2/T2 | candidate: file-format | none |
| schema:RotationMakeClass.tl | T2/T2 | candidate: file-format | none |
| schema:RotationSetClass.UpdateCollider | T2/T2 | candidate: file-format | none |
| schema:RotationSetClass.ctl | T2/T2 | candidate: file-format | none |

15 more: wb_census find with module=ProcAnimEditor kind=schema-key.

### shortcut (20)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ProcAnimEditor/shortcut/Procedural Animation Editor/Close | T2/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/shortcut/Procedural Animation Editor/Copy | T2/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/shortcut/Procedural Animation Editor/Create Group | T2/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/shortcut/Procedural Animation Editor/Cut | T2/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/shortcut/Procedural Animation Editor/Exit | T2/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/shortcut/Procedural Animation Editor/Item Detail | T2/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/shortcut/Procedural Animation Editor/Item Explorer | T2/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/shortcut/Procedural Animation Editor/Log Console | T2/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/shortcut/Procedural Animation Editor/Open | T2/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/shortcut/Procedural Animation Editor/Paste | T2/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/shortcut/Procedural Animation Editor/Project... | T2/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/shortcut/Procedural Animation Editor/Redo | T2/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/shortcut/Procedural Animation Editor/Resource Browser | T2/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/shortcut/Procedural Animation Editor/Save | T2/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/shortcut/Procedural Animation Editor/Save All | T2/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/shortcut/Procedural Animation Editor/Save As | T2/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/shortcut/Procedural Animation Editor/Signal... | T2/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/shortcut/Procedural Animation Editor/Start Debugging | T2/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/shortcut/Procedural Animation Editor/Undo | T2/T2 | candidate: gui-automation | none |
| ui:ProcAnimEditor/shortcut/Procedural Animation Editor/View | T2/T2 | candidate: gui-automation | none |

### status-item (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ProcAnimEditor/status-item/statusBar/Version 1.8.0.13 (production) | T2/T2 | candidate: gui-automation | none |

### tool (7)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ProcAnimEditor/tool/animation_find_unused_clips | T0/T5 | candidate: file-format | none |
| ui:ProcAnimEditor/tool/animation_graph action=author | T0/T5 | candidate: file-format | none |
| ui:ProcAnimEditor/tool/animation_graph action=inspect | T0/T5 | candidate: file-format | none |
| ui:ProcAnimEditor/tool/animation_graph inspect validate | T0/T5 | candidate: file-format | none |
| ui:ProcAnimEditor/tool/character_anim_pipeline_guide prompt | T0/T5 | candidate: gui-automation, plugin-run | none |
| ui:ProcAnimEditor/tool/project_validate scope=anim | T0/T5 | candidate: file-format | none |
| ui:ProcAnimEditor/tool/weapon_pose_lint | T0/T5 | candidate: file-format | none |

### toolbar (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ProcAnimEditor/toolbar/#toolBar | T0/T3 | candidate: gui-automation | none |
| ui:ProcAnimEditor/toolbar/viewDockWidget/dockViewContents/@QToolBar.1 | T0/T3 | candidate: gui-automation | none |

### toolbar-button (14)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ProcAnimEditor/toolbar-button/viewDockWidget/dockViewContents/@QToolBar.1/BSP | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/toolbar-button/viewDockWidget/dockViewContents/@QToolBar.1/Camera distance | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/toolbar-button/viewDockWidget/dockViewContents/@QToolBar.1/Change FOV | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/toolbar-button/viewDockWidget/dockViewContents/@QToolBar.1/Check occlusion | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/toolbar-button/viewDockWidget/dockViewContents/@QToolBar.1/Colliders | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/toolbar-button/viewDockWidget/dockViewContents/@QToolBar.1/EV Minus | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/toolbar-button/viewDockWidget/dockViewContents/@QToolBar.1/EV Plus | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/toolbar-button/viewDockWidget/dockViewContents/@QToolBar.1/Lock EV | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/toolbar-button/viewDockWidget/dockViewContents/@QToolBar.1/Reset model bones transformations to init state | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/toolbar-button/viewDockWidget/dockViewContents/@QToolBar.1/Select model | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/toolbar-button/viewDockWidget/dockViewContents/@QToolBar.1/Show bones | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/toolbar-button/viewDockWidget/dockViewContents/@QToolBar.1/Show grid | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/toolbar-button/viewDockWidget/dockViewContents/@QToolBar.1/Show volumetric info | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ProcAnimEditor/toolbar-button/viewDockWidget/dockViewContents/@QToolBar.1/Turn camera to POI on mouse wheel | T2/T5 | candidate: execute-action, gui-automation | none |

### window (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ProcAnimEditor/window/#ProcAnimEditorMainWindow | T2/T3 | candidate: gui-automation | none |

## Below target (185)

- T0 to T2: 44
- T0 to T3: 14
- T0 to T5: 48
- T1 to T3: 6
- T1 to T5: 2
- T2 to T3: 16
- T2 to T5: 54
- T3 to T5: 1

| id | tier | path |
| --- | --- | --- |
| api:class/PAP compiled block | T0/T2 | candidate: none-known |
| api:class/PAP connections | T0/T2 | candidate: file-format |
| api:class/PAP node Bone (BoneClass) | T0/T2 | candidate: file-format |
| api:class/PAP node Constants | T0/T2 | candidate: file-format |
| api:class/PAP node RotationBreak | T0/T2 | candidate: file-format |
| api:class/PAP node RotationMake | T0/T2 | candidate: file-format |
| api:class/PAP node RotationSet | T0/T2 | candidate: file-format |
| api:class/PAP node Signal (SignalClass) | T0/T2 | candidate: file-format |
| api:class/PAP node TranslateBreak | T0/T2 | candidate: file-format |
| api:class/PAP node TranslateMake | T0/T2 | candidate: file-format |
| api:class/PAP node TranslateSet | T0/T2 | candidate: file-format |
| api:class/SIGA Generator (IOPInputGeneratorClass) | T0/T2 | candidate: file-format |
| api:class/SIGA Input (IOPItemInputClass) | T0/T2 | candidate: file-format |
| api:class/SIGA Output (IOPItemOutputClass) | T0/T2 | candidate: file-format |
| api:class/SIGA Random (IOPInputRandomClass) | T0/T2 | candidate: file-format |
| api:class/SIGA Value (IOPInputValueClass) | T0/T2 | candidate: file-format |
| api:class/SIGA compiled block | T0/T2 | candidate: none-known |
| api:class/SIGA inputs LFO, Time, Variable, CurveModulator, SquareModulator | T0/T2 | candidate: file-format |
| api:class/SIGA math ops Sum, Sub, Mul, Div, Min, Max, Pow, Remainder, Abs, Exp, Ln, Log2, Log10 | T0/T2 | candidate: file-format |
| api:class/SIGA ops Average, Smoother, Interpolate, Env, Convertor | T0/T2 | candidate: file-format |
| api:class/SIGA ops Condition, Filter, Delta, Modulo | T0/T2 | candidate: file-format |
| api:class/SIGA ops Db2Gain, Gain2Db, St2Gain, Gain2St, Freq2Oc | T0/T2 | candidate: file-format |
| api:class/SIGA ops Floor, Ceil, Round, Clamp, ClampMin, ClampMax | T0/T2 | candidate: file-format |
| api:class/SIGA ops Sin, Cos, Tan, ASin, ACos, ATan | T0/T2 | candidate: file-format |
| api:method/Module class AnimEditor | T0/T5 | candidate: net-api-handler |
| api:method/Module class BehaviorEditor | T0/T5 | candidate: net-api-handler |
| api:method/Module class ProcAnimEditor | T0/T5 | candidate: net-api-handler |
| api:method/WBModuleDef.Close() | T0/T5 | candidate: net-api-handler |
| api:method/WBModuleDef.ExecuteAction(array menuPath, bool bKeepFocus=true) | T0/T5 | candidate: execute-action |
| api:method/WBModuleDef.GetCmdLine(string name, out string value) | T0/T5 | candidate: net-api-handler, plugin-run |
| api:method/WBModuleDef.GetContainer(int index=0) | T0/T5 | candidate: net-api-handler |
| api:method/WBModuleDef.GetNumContainers() | T0/T5 | candidate: net-api-handler |
| api:method/WBModuleDef.GetPlugin(typename pluginType) | T0/T5 | candidate: plugin-run |
| api:method/WBModuleDef.Save() | T0/T5 | candidate: net-api-handler |
| api:method/WBModuleDef.SetOpenedResource(string filename) | T0/T5 | candidate: net-api-handler |
| api:method/Workbench.OpenResource(string filename) | T0/T5 | candidate: net-api-handler |
| api:method/pointer.ToString() | T0/T5 | candidate: net-api-handler |
| cli:cli-switch/CLI module launch | T0/T5 | candidate: cli |
| cli:cli-switch/enfusion:%2F%2F links | T0/T5 | candidate: cli |
| file:.pap | T2/T3 | candidate: file-format |
| file:.siga | T2/T3 | candidate: file-format |
| file:file-type/.siga file | T0/T3 | candidate: file-format |
| link:enfusion://ProcAnimEditor | T1/T5 | candidate: cli |
| link:https://community.bistudio.com/wiki/Arma_Reforger:Procedural_Animation_Editor | T2/T5 | candidate: file-format |
| net:net-handler/Built-in APIFunc BringModuleWindowToFront | T0/T5 | candidate: builtin-net-handler |
| net:net-handler/Built-in APIFunc EvaluateScript | T0/T5 | candidate: builtin-net-handler |
| net:net-handler/Built-in APIFunc OpenResource | T0/T5 | candidate: builtin-net-handler |
| plugin:plugin/Workbench plugins for these modules | T0/T5 | candidate: plugin-run |
| ui:ProcAnimEditor/control/#Maximize-Restore | T2/T5 | candidate: gui-automation |
| ui:ProcAnimEditor/control/#Minimize-Restore | T2/T5 | candidate: gui-automation |
| ui:ProcAnimEditor/control/#filterButton | T0/T5 | candidate: gui-automation |
| ui:ProcAnimEditor/control/#navigateBackward | T0/T5 | candidate: gui-automation |
| ui:ProcAnimEditor/control/#navigateForward | T0/T5 | candidate: gui-automation |
| ui:ProcAnimEditor/control/#navigateUp | T0/T5 | candidate: gui-automation |
| ui:ProcAnimEditor/control/#projectTree | T0/T5 | candidate: gui-automation |
| ui:ProcAnimEditor/control/Close | T2/T5 | candidate: gui-automation |
| ui:ProcAnimEditor/control/Select model | T0/T5 | candidate: file-format |
| ui:ProcAnimEditor/control/browserDockWidget/Close | T2/T5 | candidate: gui-automation |
| ui:ProcAnimEditor/control/browserDockWidget/Float | T2/T5 | candidate: gui-automation |
| ui:ProcAnimEditor/control/browserDockWidget/browserContents/93 items | T2/T5 | candidate: gui-automation |

125 more: wb_census find with module=ProcAnimEditor.

## Dispositions (32)

| id | kind | why | evidence |
| --- | --- | --- | --- |
| api:class/PAP compiled block | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/PAP connections | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/PAP node Bone (BoneClass) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/PAP node Constants | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/PAP node RotationBreak | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/PAP node RotationMake | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/PAP node RotationSet | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/PAP node ScaleSet %2F ScaleMake %2F ScaleBreak | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/PAP node Signal (SignalClass) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/PAP node TranslateBreak | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/PAP node TranslateMake | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/PAP node TranslateSet | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/SIGA Generator (IOPInputGeneratorClass) | blocked | Only the executable holds this class name (no script declaration, no measured row, no vanilla instance in the paks); the module-container walk of P-U8 lists the container class names of the seven uncovered editors. | EV-s001-003 |
| api:class/SIGA Input (IOPItemInputClass) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/SIGA Output (IOPItemOutputClass) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/SIGA Random (IOPInputRandomClass) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/SIGA Value (IOPInputValueClass) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/SIGA compiled block | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/SIGA inputs LFO, Time, Variable, CurveModulator, SquareModulator | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/SIGA math ops Sum, Sub, Mul, Div, Min, Max, Pow, Remainder, Abs, Exp, Ln, Log2, Log10 | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/SIGA ops Average, Smoother, Interpolate, Env, Convertor | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/SIGA ops Condition, Filter, Delta, Modulo | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/SIGA ops Db2Gain, Gain2Db, St2Gain, Gain2St, Freq2Oc | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/SIGA ops Floor, Ceil, Round, Clamp, ClampMin, ClampMax | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/SIGA ops Sin, Cos, Tan, ASin, ACos, ATan | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:method/Module class AnimEditor | duplicate-of | duplicate-of:api:AnimEditor (proposal docs/v2/inbox/w4/remainder.jsonl; api:AnimEditor at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:method/Module class BehaviorEditor | duplicate-of | duplicate-of:api:BehaviorEditor (proposal docs/v2/inbox/w4/remainder.jsonl; api:BehaviorEditor at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:method/Module class ProcAnimEditor | duplicate-of | duplicate-of:api:ProcAnimEditor (proposal docs/v2/inbox/w4/remainder.jsonl; api:ProcAnimEditor at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| cli:cli-switch/CLI module launch | blocked | blocked:P-W6-09 (Workbench launch switch; wb_launch pass-through, W6) [ledger work_item none] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| ui:ProcAnimEditor/menu-item/File/Exit | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ProcAnimEditor/menu-item/Window/Reset Default Layouts | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ProcAnimEditor/shortcut/Procedural Animation Editor/Exit | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
