# Census: BehaviorEditor

1977 rows (8 aggregate excluded).

## What it is

Module BehaviorEditor: api 8, diag 1, file 3, link 2, plugin 1, schema 1754, setting 11, ui 197. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- class BehaviorEditor (api:BehaviorEditor)
- class Variables (api:Variables): BtVariableEntity, Vector, Scalar, Bool, Object, Integer, String, Typename, ResourceName, Group, AISmartActionComponent (11 types)
- class Flow nodes (api:class/Flow nodes): RootNode 113, Sequence 378, Selector 136, Parallel 61, RunBT 49, ForEachChild 13, Repeater 6, Switch 5, RunOnce 4, RunOnEntity 0, OnEvent 0
- class Native decorators (api:class/Native decorators): Decorator, DecoTestVariable 134, DecoratorEntity 60, DecoIsInVehicle 15, DecoTestDistanceToEntity 10, DecoAiming 4, DecoTestOrder 1, DecoDangerEvent, DecoCheckLOD, DecoratorPathCompletedTest, DecoratorTimedDangerPerception, DecoratorTest* (HasAmmo, HasWeapon, IsWeaponRaised, DamageIsAlive, HasAimRequest, HasMoveRequest, CanPerformSmartActions, IsPerformingSmartAction), DecoratorWeaponObstructed
- class Native tasks (AITask*, 39 non-scripted direct children) (api:class/Native tasks (AITask*, 39 non-scripted direct children)): AITaskIdle 114, AITaskSetVariable 110, AITaskReturnState 178, AITaskMove 34, AITaskGetControlledEntity 25, AITaskCharacterAim 25, AITaskCreatePosition 17, ... full list in API
- class Ports and references (api:class/Ports and references): InPorts / OutPorts with SingleInputPortContainer 943 / SingleOutputPortContainer 593 (Port, PortName), VariableReference 1,186 (VariableType 0-16, EditorPos)
- class Scripted decorators (33 DecoratorScripted descendants, 27 DecoratorTestScripted) (api:class/Scripted decorators (33 DecoratorScripted descendants, 27 DecoratorTestScripted)): TestFunction(owner)
- class Scripted tasks (277 AITaskScripted descendants) (api:class/Scripted tasks (277 AITaskScripted descendants)): SCR_AI* nodes; parameters = [Attribute] members; ports from GetVariablesIn/Out
- file-type .bt (file:.bt): AI behaviour tree
- file-type .fsm (file:.fsm): Appears only as a save-dialog filter string bt;fsm
- file-type .bt file (file:file-type/.bt file): Root BehaviorTree "{guid}path" (some without GUID); 113 files (Soldier 67, Group 20, Waypoints 16, SmartActions 9, Animals 1), max 29 KB, text; properties may follow the Nodes block
- schema-class AIAnimalManagerReactToCloseEntitiesMovement (schema:AIAnimalManagerReactToCloseEntitiesMovement): 1 instances in 1 .bt files of the 1.9.0.37 paks; nested
- ... 374 more

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| api | 7 | 0 | 1 | 0 | 0 | 0 | 8 |
| diag | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| file | 2 | 0 | 1 | 0 | 0 | 0 | 3 |
| link | 0 | 1 | 1 | 0 | 0 | 0 | 2 |
| plugin | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| schema | 0 | 0 | 1754 | 0 | 0 | 0 | 1754 |
| setting | 11 | 0 | 0 | 0 | 0 | 0 | 11 |
| ui | 70 | 35 | 88 | 1 | 0 | 3 | 197 |

## By kind

- canvas-gesture: 8
- class: 8
- control: 50
- diag-option: 1
- dock: 8
- file-type: 3
- link-format: 2
- menu: 6
- menu-item: 27
- module: 1
- option: 1
- panel: 22
- plugin: 1
- property-group: 4
- region: 17
- schema-class: 343
- schema-key: 1411
- setting-key: 11
- shortcut: 19
- status-item: 1
- tab: 12
- toolbar: 3
- toolbar-button: 17
- window: 1

## By risk

- destructive: 2
- mutating: 130
- safe: 1845

## Rows by kind

### canvas-gesture (8)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:BehaviorEditor/canvas-gesture/Node area/Connect nodes | T1/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/canvas-gesture/Node area/Disconnect node | T1/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/canvas-gesture/Node area/Move around behavior tree | T1/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/canvas-gesture/Node area/Open scripted node script | T1/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/canvas-gesture/Node area/Organise nodes | T1/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/canvas-gesture/Node area/Select multiple nodes | T1/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/canvas-gesture/Node area/Zoom in%2Fout | T1/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/canvas-gesture/Open scripted node script | T0/T2 | candidate: net-api-handler | none |

### class (8)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:BehaviorEditor | T2/T2 | candidate: none-known | none |
| api:Variables | T0/T2 | candidate: file-format | none |
| api:class/Flow nodes | T0/T2 | candidate: file-format | none |
| api:class/Native decorators | T0/T2 | candidate: file-format | none |
| api:class/Native tasks (AITask*, 39 non-scripted direct children) | T0/T2 | candidate: file-format | none |
| api:class/Ports and references | T0/T2 | candidate: file-format | none |
| api:class/Scripted decorators (33 DecoratorScripted descendants, 27 DecoratorTestScripted) | T0/T2 | candidate: none-known | none |
| api:class/Scripted tasks (277 AITaskScripted descendants) | T0/T2 | candidate: none-known | none |

### control (50)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:BehaviorEditor/control/#Maximize-Restore | T2/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/#Minimize-Restore | T2/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/#debugTree | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/#filterButton | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/#m_BehaviorEditorConsole | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/#m_BehaviorEditorPaletteWidget | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/#navigateBackward | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/#navigateForward | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/#navigateUp | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/Close | T2/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/breakpointsPanelDock/@BreakpointsPanel.1 | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/breakpointsPanelDock/@QToolButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/breakpointsPanelDock/@QToolButton.2 | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/breakpointsPanelDock/@QToolButton.3 | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/breakpointsPanelDock/@WBEditBox.1 | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/breakpointsPanelDock/@WBEditBox.1/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/breakpointsPanelDock/Close | T2/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/breakpointsPanelDock/Float | T2/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/consolePanelDock/Close | T2/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/consolePanelDock/Float | T2/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/debugPanelDock/@WBEditBox.1 | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/debugPanelDock/@WBEditBox.1/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/debugPanelDock/Close | T2/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/debugPanelDock/Float | T2/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/itemExplorerPanelDock/@ItemExplorerPanel.1 | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/itemExplorerPanelDock/@WBEditBox.1 | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/itemExplorerPanelDock/@WBEditBox.1/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/itemExplorerPanelDock/Float | T2/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/nodeParametersPanelDock/@QPushButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/nodeParametersPanelDock/@WBEditBox.1 | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/nodeParametersPanelDock/@WBEditBox.1/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/nodeParametersPanelDock/Float | T2/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/nodesPalettePanelDock/@WBEditBox.1 | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/nodesPalettePanelDock/@WBEditBox.1/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/nodesPalettePanelDock/Close | T2/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/nodesPalettePanelDock/Float | T2/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/resourceBrowserPanelDock/152 items | T2/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/resourceBrowserPanelDock/@QPushButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/resourceBrowserPanelDock/@ResourceListView.1 | T0/T5 | candidate: gui-automation | none |
| ui:BehaviorEditor/control/resourceBrowserPanelDock/@ResourceTreeView.1 | T0/T5 | candidate: gui-automation | none |

10 more: wb_census find with module=BehaviorEditor kind=control.

### diag-option (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| diag:diag-option/AI Debug Panel | T0/T2 | candidate: gui-automation | none |

### dock (8)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:BehaviorEditor/dock/#breakpointsPanelDock | T2/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/dock/#consolePanelDock | T2/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/dock/#debugPanelDock | T2/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/dock/#itemExplorerPanelDock | T2/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/dock/#nodeParametersPanelDock | T2/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/dock/#nodesPalettePanelDock | T2/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/dock/#resourceBrowserPanelDock | T2/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/dock/#variablesPanelDock | T2/T3 | candidate: gui-automation | none |

### file-type (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| file:.bt | T2/T3 | candidate: file-format | [behavior_tree.create](../tools/behavior_tree.md) drive, [behavior_tree.diff](../tools/behavior_tree.md) read, [behavior_tree.edit](../tools/behavior_tree.md) drive, [behavior_tree.inspect](../tools/behavior_tree.md) read, [behavior_tree.nodes](../tools/behavior_tree.md) read, [behavior_tree.validate](../tools/behavior_tree.md) read |
| file:.fsm | T0/T3 | candidate: file-format | none |
| file:file-type/.bt file | T0/T3 | candidate: file-format | none |

### link-format (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| link:enfusion://BehaviorEditor | T1/T5 | candidate: cli | [wb_link.build](../tools/wb_link.md) read, [wb_link.open](../tools/wb_link.md) drive, [wb_link.parse](../tools/wb_link.md) read |
| link:https://community.bistudio.com/wiki/Arma_Reforger:Behavior_Editor | T2/T5 | candidate: file-format | none |

### menu (6)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:BehaviorEditor/menu/Debug | T2/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/menu/Edit | T2/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/menu/File | T2/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/menu/Help | T2/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/menu/Window | T2/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/menu/Window/Layout | T2/T3 | candidate: gui-automation | none |

### menu-item (27)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:BehaviorEditor/menu-item/Close All Debug Instances | T0/T5 | candidate: execute-action | none |
| ui:BehaviorEditor/menu-item/Debug/Continue | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/menu-item/Debug/Pause | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/menu-item/Debug/Toggle Breakpoint | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/menu-item/Edit/Copy | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/menu-item/Edit/Cut | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/menu-item/Edit/Group | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/menu-item/Edit/Paste | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/menu-item/Edit/Redo | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/menu-item/Edit/Undo | T3/T5 | candidate: execute-action, gui-automation | [wb_module.action](../tools/wb_module.md) drive |
| ui:BehaviorEditor/menu-item/Edit/Ungroup | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/menu-item/File/Exit | T2/T2 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/menu-item/File/New | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/menu-item/File/Open | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/menu-item/File/Options... | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/menu-item/File/Save | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/menu-item/File/Save As | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/menu-item/Help/View Help | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/menu-item/Window/Breakpoints | T5/T5 | execute-action | [wb_module.action](../tools/wb_module.md) drive |
| ui:BehaviorEditor/menu-item/Window/Close Tab | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/menu-item/Window/Debug | T5/T5 | execute-action | [wb_module.action](../tools/wb_module.md) drive |
| ui:BehaviorEditor/menu-item/Window/Layout/Create New Layout | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/menu-item/Window/Layout/edit | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/menu-item/Window/Manage Layouts | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/menu-item/Window/Nodes palette | T5/T5 | execute-action | [wb_module.action](../tools/wb_module.md) drive |
| ui:BehaviorEditor/menu-item/Window/Reopen Closed Tab | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/menu-item/Window/Reset Default Layouts | T2/T2 | candidate: execute-action, gui-automation | none |

### module (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:BehaviorEditor/module/BehaviorEditor | T1/T5 | candidate: builtin-net-handler, net-api-handler | [wb_module.info](../tools/wb_module.md) drive |

### option (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:BehaviorEditor/option/Option: Restore session | T0/T5 | candidate: gui-automation | none |

### panel (22)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:BehaviorEditor/panel/#dockWidgetContents | T0/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/panel/#qt_tabwidget_tabbar | T0/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/panel/#statusbar | T0/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/panel/@QMainWindowTabBar.1 | T1/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/panel/@QMainWindowTabBar.2 | T1/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/panel/@QMainWindowTabBar.3 | T1/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/panel/Breakpoints (breakpointsPanelDock) | T0/T3 | candidate: gui-automation, net-api-handler | none |
| ui:BehaviorEditor/panel/Console | T1/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/panel/Console (consolePanelDock) | T0/T3 | candidate: file-format | none |
| ui:BehaviorEditor/panel/Debug | T2/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/panel/Debug (debugPanelDock) | T0/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/panel/Item Explorer (itemExplorerPanelDock) | T0/T3 | candidate: file-format | none |
| ui:BehaviorEditor/panel/Item explorer | T2/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/panel/Node area | T1/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/panel/Node area (BehaviorEditorGraphEditor) | T0/T3 | candidate: file-format, gui-automation | none |
| ui:BehaviorEditor/panel/Node parameters | T2/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/panel/Node parameters (nodeParametersPanelDock) | T0/T3 | candidate: file-format | none |
| ui:BehaviorEditor/panel/Nodes palette | T1/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/panel/Nodes palette (nodesPalettePanelDock) | T0/T3 | candidate: file-format | none |
| ui:BehaviorEditor/panel/Resource Browser (resourceBrowserPanelDock) | T0/T3 | candidate: file-format | none |
| ui:BehaviorEditor/panel/Variables | T1/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/panel/Variables (variablesPanelDock) | T0/T3 | candidate: file-format | none |

### plugin (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:plugin/Plugin: Validate Behavior Trees | T0/T5 | candidate: cli, plugin-run | none |

### property-group (4)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:BehaviorEditor/property-group/Decorator common parameters | T0/T3 | candidate: file-format | none |
| ui:BehaviorEditor/property-group/In-game setup | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:BehaviorEditor/property-group/Node common keys | T0/T3 | candidate: file-format | none |
| ui:BehaviorEditor/property-group/nodeParametersPanelDock/@PropertyGridBC.1 | T0/T3 | candidate: gui-automation | none |

### region (17)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:BehaviorEditor/region/#SystemMenuBar | T0/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/region/#centralwidget | T0/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/region/#consolePanel | T0/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/region/#menubar | T0/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/region/#qt_splithandle_gridPanel | T0/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/region/#resourceBrowserPanel | T0/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/region/@TitleBar.1 | T0/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/region/debugPanelDock/debugTree/@Header.1 | T0/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/region/debugPanelDock/debugTree/@Header.2 | T0/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/region/debugPanelDock/debugTree/@Header.3 | T0/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/region/resourceBrowserPanelDock/@BreadcrumbTrailWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/region/statusbar/@QSizeGrip.1 | T0/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/region/toolBar/@QToolBarSeparator.1 | T0/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/region/toolBar/@QToolBarSeparator.2 | T0/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/region/toolBar/@QToolBarSeparator.3 | T0/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/region/variablesPanelDock/dockWidgetContents/@VariablesPanel.1/@Header.1 | T0/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/region/variablesPanelDock/dockWidgetContents/@VariablesPanel.1/@Header.2 | T0/T2 | candidate: gui-automation | none |

### schema-class (343)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:AIAnimalManagerReactToCloseEntitiesMovement | T2/T2 | candidate: file-format | none |
| schema:AIAnimalReactToDanger | T2/T2 | candidate: file-format | none |
| schema:AITaskAim | T2/T2 | candidate: file-format | none |
| schema:AITaskCallMethod | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterAim | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterRaiseWeapon | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterSetMovementSpeed | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterStop | T2/T2 | candidate: file-format | none |
| schema:AITaskClearDanger | T2/T2 | candidate: file-format | none |
| schema:AITaskCreatePosition | T2/T2 | candidate: file-format | none |
| schema:AITaskCurrentOrder | T2/T2 | candidate: file-format | none |
| schema:AITaskFindSmartAction | T2/T2 | candidate: file-format | none |
| schema:AITaskFinishOrder | T2/T2 | candidate: file-format | none |
| schema:AITaskFire | T2/T2 | candidate: file-format | none |
| schema:AITaskGetControlledEntity | T2/T2 | candidate: file-format | none |
| schema:AITaskGetCurrentSmartAction | T2/T2 | candidate: file-format | none |
| schema:AITaskGetFormationOffset | T2/T2 | candidate: file-format | none |
| schema:AITaskGetGroupChildren | T2/T2 | candidate: file-format | none |
| schema:AITaskGetInVehicle | T2/T2 | candidate: file-format | none |
| schema:AITaskGetOutVehicle | T2/T2 | candidate: file-format | none |
| schema:AITaskGetSmartActionParams | T2/T2 | candidate: file-format | none |
| schema:AITaskGetWaypoint | T2/T2 | candidate: file-format | none |
| schema:AITaskGroupMove | T2/T2 | candidate: file-format | none |
| schema:AITaskGroupMoveToEntity | T2/T2 | candidate: file-format | none |
| schema:AITaskGroupSetMovementSpeed | T2/T2 | candidate: file-format | none |
| schema:AITaskIdle | T2/T2 | candidate: file-format | none |
| schema:AITaskMove | T2/T2 | candidate: file-format | none |
| schema:AITaskMoveInFormation | T2/T2 | candidate: file-format | none |
| schema:AITaskMoveToEntity | T2/T2 | candidate: file-format | none |
| schema:AITaskMoveToWaypoint | T2/T2 | candidate: file-format | none |
| schema:AITaskPerformSmartAction | T2/T2 | candidate: file-format | none |
| schema:AITaskRequestAction | T2/T2 | candidate: file-format | none |
| schema:AITaskResetPathfindingFilters | T2/T2 | candidate: file-format | none |
| schema:AITaskReturnState | T2/T2 | candidate: file-format | none |
| schema:AITaskSetPathfindingFilters | T2/T2 | candidate: file-format | none |
| schema:AITaskSetVariable | T2/T2 | candidate: file-format | none |
| schema:AITaskThrowGrenade | T2/T2 | candidate: file-format | none |
| schema:BTGroup | T2/T2 | candidate: file-format | none |
| schema:BehaviorTree | T2/T2 | candidate: file-format | none |
| schema:BtVariableAISmartActionComponent | T2/T2 | candidate: file-format | none |

303 more: wb_census find with module=BehaviorEditor kind=schema-class.

### schema-key (1411)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:AIAnimalManagerReactToCloseEntitiesMovement.CarTriggerChance | T2/T2 | candidate: file-format | none |
| schema:AIAnimalManagerReactToCloseEntitiesMovement.EditorPos | T2/T2 | candidate: file-format | none |
| schema:AIAnimalManagerReactToCloseEntitiesMovement.MaxDistance | T2/T2 | candidate: file-format | none |
| schema:AIAnimalManagerReactToCloseEntitiesMovement.Name | T2/T2 | candidate: file-format | none |
| schema:AIAnimalManagerReactToCloseEntitiesMovement.Nodes | T2/T2 | candidate: file-format | none |
| schema:AIAnimalManagerReactToCloseEntitiesMovement.RunTriggerChance | T2/T2 | candidate: file-format | none |
| schema:AIAnimalManagerReactToCloseEntitiesMovement.WalkTriggerChance | T2/T2 | candidate: file-format | none |
| schema:AIAnimalReactToDanger.EditorPos | T2/T2 | candidate: file-format | none |
| schema:AIAnimalReactToDanger.Name | T2/T2 | candidate: file-format | none |
| schema:AITaskAim.EditorPos | T2/T2 | candidate: file-format | none |
| schema:AITaskAim.Group | T2/T2 | candidate: file-format | none |
| schema:AITaskAim.InAimAtPosition | T2/T2 | candidate: file-format | none |
| schema:AITaskAim.Name | T2/T2 | candidate: file-format | none |
| schema:AITaskAim.PrecisionXZ | T2/T2 | candidate: file-format | none |
| schema:AITaskAim.PrecisionY | T2/T2 | candidate: file-format | none |
| schema:AITaskCallMethod.EditorPos | T2/T2 | candidate: file-format | none |
| schema:AITaskCallMethod.InObject | T2/T2 | candidate: file-format | none |
| schema:AITaskCallMethod.MethodName | T2/T2 | candidate: file-format | none |
| schema:AITaskCallMethod.Name | T2/T2 | candidate: file-format | none |
| schema:AITaskCallMethod.OutResult | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterAim.AimType | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterAim.EditorPos | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterAim.Group | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterAim.InAimAtPosition | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterAim.InAimOffset | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterAim.InAimPoint | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterAim.InEntity | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterAim.InPrecisionXZ | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterAim.InPrecisionY | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterAim.InTimeout | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterAim.Name | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterAim.PrecisionXZ | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterAim.PrecisionY | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterAim.Timeout | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterAim.UseADS | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterRaiseWeapon.EditorPos | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterRaiseWeapon.Name | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterRaiseWeapon.Raise | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterSetMovementSpeed.EditorPos | T2/T2 | candidate: file-format | none |
| schema:AITaskCharacterSetMovementSpeed.Group | T2/T2 | candidate: file-format | none |

1371 more: wb_census find with module=BehaviorEditor kind=schema-key.

### setting-key (11)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| setting:Behavior Editor%2FDEBUG_PANEL_COLUMN%2F1/WIDTH | T0/T3 | candidate: file-format | none |
| setting:Behavior Editor%2FDEBUG_PANEL_COLUMN%2F2/WIDTH | T0/T3 | candidate: file-format | none |
| setting:Behavior Editor%2FDEBUG_PANEL_COLUMN%2F3/WIDTH | T0/T3 | candidate: file-format | none |
| setting:Behavior Editor%2FDEBUG_PANEL_COLUMN/size | T0/T3 | candidate: file-format | none |
| setting:Behavior Editor%2FPerspectives%2Fedit/Geometry | T0/T3 | candidate: file-format | none |
| setting:Behavior Editor%2FPerspectives%2Fedit/State | T0/T3 | candidate: file-format | none |
| setting:Behavior Editor/OPEN_FILES | T0/T3 | candidate: file-format | none |
| setting:Behavior Editor/OPEN_FILE_INDEX | T0/T3 | candidate: file-format | none |
| setting:Behavior Editor/QuickAcess | T0/T3 | candidate: file-format | none |
| setting:Behavior Editor/currentPerspective | T0/T3 | candidate: file-format | none |
| setting:Behavior Editor/legacyOptionsLoaded | T0/T3 | candidate: file-format | none |

### shortcut (19)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:BehaviorEditor/shortcut/Behavior Editor/Continue | T2/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/shortcut/Behavior Editor/Copy | T2/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/shortcut/Behavior Editor/Cut | T2/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/shortcut/Behavior Editor/Group | T2/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/shortcut/Behavior Editor/Open | T2/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/shortcut/Behavior Editor/Paste | T2/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/shortcut/Behavior Editor/Pause | T2/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/shortcut/Behavior Editor/Save | T2/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/shortcut/Behavior Editor/Save As | T2/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/shortcut/Behavior Editor/Toggle Breakpoint | T2/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/shortcut/Behavior Editor/Ungroup | T2/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/shortcut/Copy | T1/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/shortcut/Create%2Fdelete breakpoint | T1/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/shortcut/Cut | T1/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/shortcut/Delete node, variable or connection | T1/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/shortcut/Open | T1/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/shortcut/Paste | T1/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/shortcut/Save | T1/T2 | candidate: gui-automation | none |
| ui:BehaviorEditor/shortcut/Save As | T1/T2 | candidate: gui-automation | none |

### status-item (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:BehaviorEditor/status-item/statusbar/Version 1.8.0.13 (production) | T2/T2 | candidate: gui-automation | none |

### tab (12)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:BehaviorEditor/tab/@QMainWindowTabBar/Breakpoints | T1/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/tab/@QMainWindowTabBar/Debug | T1/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/tab/@QMainWindowTabBar/Item explorer | T1/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/tab/@QMainWindowTabBar/Node parameters | T1/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/tab/@QMainWindowTabBar/Nodes palette | T1/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/tab/@QMainWindowTabBar/Resource Browser | T1/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/tab/Debug/Breakpoints | T1/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/tab/Debug/Debug | T1/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/tab/Item explorer/Item explorer | T1/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/tab/Item explorer/Nodes palette | T1/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/tab/Node parameters/Node parameters | T1/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/tab/Node parameters/Resource Browser | T1/T3 | candidate: gui-automation | none |

### toolbar (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:BehaviorEditor/toolbar/#toolBar | T0/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/toolbar/@QToolBar.1 | T0/T3 | candidate: gui-automation | none |
| ui:BehaviorEditor/toolbar/@QToolBar.2 | T0/T3 | candidate: gui-automation | none |

### toolbar-button (17)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:BehaviorEditor/toolbar-button/@QToolBar.1/Parallel | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/toolbar-button/@QToolBar.1/Selector | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/toolbar-button/@QToolBar.1/Sequence | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/toolbar-button/@QToolBar.2/Parallel | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/toolbar-button/@QToolBar.2/Selector | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/toolbar-button/@QToolBar.2/Sequence | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/toolbar-button/toolBar/Continue | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/toolbar-button/toolBar/Copy | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/toolbar-button/toolBar/Cut | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/toolbar-button/toolBar/New | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/toolbar-button/toolBar/Open | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/toolbar-button/toolBar/Paste | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/toolbar-button/toolBar/Pause | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/toolbar-button/toolBar/Redo | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/toolbar-button/toolBar/Save | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/toolbar-button/toolBar/Toggle Breakpoint | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:BehaviorEditor/toolbar-button/toolBar/Undo | T2/T5 | candidate: execute-action, gui-automation | none |

### window (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:BehaviorEditor/window/#BehaviorEditorMain | T2/T3 | candidate: gui-automation | none |

## Below target (205)

- T0 to T2: 26
- T0 to T3: 32
- T0 to T5: 34
- T1 to T2: 15
- T1 to T3: 19
- T1 to T5: 2
- T2 to T3: 19
- T2 to T5: 57
- T3 to T5: 1

| id | tier | path |
| --- | --- | --- |
| api:Variables | T0/T2 | candidate: file-format |
| api:class/Flow nodes | T0/T2 | candidate: file-format |
| api:class/Native decorators | T0/T2 | candidate: file-format |
| api:class/Native tasks (AITask*, 39 non-scripted direct children) | T0/T2 | candidate: file-format |
| api:class/Ports and references | T0/T2 | candidate: file-format |
| api:class/Scripted decorators (33 DecoratorScripted descendants, 27 DecoratorTestScripted) | T0/T2 | candidate: none-known |
| api:class/Scripted tasks (277 AITaskScripted descendants) | T0/T2 | candidate: none-known |
| diag:diag-option/AI Debug Panel | T0/T2 | candidate: gui-automation |
| file:.bt | T2/T3 | candidate: file-format |
| file:.fsm | T0/T3 | candidate: file-format |
| file:file-type/.bt file | T0/T3 | candidate: file-format |
| link:enfusion://BehaviorEditor | T1/T5 | candidate: cli |
| link:https://community.bistudio.com/wiki/Arma_Reforger:Behavior_Editor | T2/T5 | candidate: file-format |
| plugin:plugin/Plugin: Validate Behavior Trees | T0/T5 | candidate: cli, plugin-run |
| setting:Behavior Editor%2FDEBUG_PANEL_COLUMN%2F1/WIDTH | T0/T3 | candidate: file-format |
| setting:Behavior Editor%2FDEBUG_PANEL_COLUMN%2F2/WIDTH | T0/T3 | candidate: file-format |
| setting:Behavior Editor%2FDEBUG_PANEL_COLUMN%2F3/WIDTH | T0/T3 | candidate: file-format |
| setting:Behavior Editor%2FDEBUG_PANEL_COLUMN/size | T0/T3 | candidate: file-format |
| setting:Behavior Editor%2FPerspectives%2Fedit/Geometry | T0/T3 | candidate: file-format |
| setting:Behavior Editor%2FPerspectives%2Fedit/State | T0/T3 | candidate: file-format |
| setting:Behavior Editor/OPEN_FILES | T0/T3 | candidate: file-format |
| setting:Behavior Editor/OPEN_FILE_INDEX | T0/T3 | candidate: file-format |
| setting:Behavior Editor/QuickAcess | T0/T3 | candidate: file-format |
| setting:Behavior Editor/currentPerspective | T0/T3 | candidate: file-format |
| setting:Behavior Editor/legacyOptionsLoaded | T0/T3 | candidate: file-format |
| ui:BehaviorEditor/canvas-gesture/Node area/Connect nodes | T1/T2 | candidate: gui-automation |
| ui:BehaviorEditor/canvas-gesture/Node area/Disconnect node | T1/T2 | candidate: gui-automation |
| ui:BehaviorEditor/canvas-gesture/Node area/Move around behavior tree | T1/T2 | candidate: gui-automation |
| ui:BehaviorEditor/canvas-gesture/Node area/Open scripted node script | T1/T2 | candidate: gui-automation |
| ui:BehaviorEditor/canvas-gesture/Node area/Organise nodes | T1/T2 | candidate: gui-automation |
| ui:BehaviorEditor/canvas-gesture/Node area/Select multiple nodes | T1/T2 | candidate: gui-automation |
| ui:BehaviorEditor/canvas-gesture/Node area/Zoom in%2Fout | T1/T2 | candidate: gui-automation |
| ui:BehaviorEditor/canvas-gesture/Open scripted node script | T0/T2 | candidate: net-api-handler |
| ui:BehaviorEditor/control/#Maximize-Restore | T2/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/#Minimize-Restore | T2/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/#debugTree | T0/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/#filterButton | T0/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/#m_BehaviorEditorConsole | T0/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/#m_BehaviorEditorPaletteWidget | T0/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/#navigateBackward | T0/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/#navigateForward | T0/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/#navigateUp | T0/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/Close | T2/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/breakpointsPanelDock/@BreakpointsPanel.1 | T0/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/breakpointsPanelDock/@QToolButton.1 | T0/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/breakpointsPanelDock/@QToolButton.2 | T0/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/breakpointsPanelDock/@QToolButton.3 | T0/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/breakpointsPanelDock/@WBEditBox.1 | T0/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/breakpointsPanelDock/@WBEditBox.1/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/breakpointsPanelDock/Close | T2/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/breakpointsPanelDock/Float | T2/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/consolePanelDock/Close | T2/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/consolePanelDock/Float | T2/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/debugPanelDock/@WBEditBox.1 | T0/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/debugPanelDock/@WBEditBox.1/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/debugPanelDock/Close | T2/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/debugPanelDock/Float | T2/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/itemExplorerPanelDock/@ItemExplorerPanel.1 | T0/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/itemExplorerPanelDock/@WBEditBox.1 | T0/T5 | candidate: gui-automation |
| ui:BehaviorEditor/control/itemExplorerPanelDock/@WBEditBox.1/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation |

145 more: wb_census find with module=BehaviorEditor.

## Dispositions (8)

| id | kind | why | evidence |
| --- | --- | --- | --- |
| api:Variables | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Flow nodes | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Native decorators | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Native tasks (AITask*, 39 non-scripted direct children) | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/Ports and references | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| file:.fsm | blocked | The executable holds the .fsm extension as a string and no static source describes it; which editor opens or writes it is P-FILETYPES-EXE. | EV-s001-003 |
| ui:BehaviorEditor/menu-item/File/Exit | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:BehaviorEditor/menu-item/Window/Reset Default Layouts | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
