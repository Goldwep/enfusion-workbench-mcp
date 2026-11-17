# Census: ResourceManager.Config

4531 rows (1 aggregate excluded).

## What it is

Module ResourceManager.Config: api 2, file 4, schema 4495, ui 30. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- file-type .conf (file:.conf): Generic config
- file-type .gamemat (file:.gamemat): Definition of in-game material (properties, sound, etc)
- file-type .physmat (file:.physmat): Physical material (bounciness, adherence etc)
- file-type .vhcsurf (file:.vhcsurf): Surface properties that are used inside vehicle simulation (roughness, steering noise etc.)
- schema-class AIAmbientLightProbeSystem (schema:AIAmbientLightProbeSystem): 1 instances in 1 .conf files of the 1.9.0.37 paks; nested
- schema-class AICarMovementComponentSerializer (schema:AICarMovementComponentSerializer): 2 instances in 2 .conf files of the 1.9.0.37 paks; nested
- schema-class AICenterOfMassSystem (schema:AICenterOfMassSystem): 1 instances in 1 .conf files of the 1.9.0.37 paks; nested
- schema-class AIControlComponentSerializer (schema:AIControlComponentSerializer): 1 instances in 1 .conf files of the 1.9.0.37 paks; nested
- schema-class AIDiagSystem (schema:AIDiagSystem): 1 instances in 1 .conf files of the 1.9.0.37 paks; nested
- schema-class AIFlockUpdateSystem (schema:AIFlockUpdateSystem): 1 instances in 1 .conf files of the 1.9.0.37 paks; nested
- schema-class AIFormationComponentSerializer (schema:AIFormationComponentSerializer): 1 instances in 1 .conf files of the 1.9.0.37 paks; nested
- schema-class AIObstacleAvoidanceSystem (schema:AIObstacleAvoidanceSystem): 1 instances in 1 .conf files of the 1.9.0.37 paks; nested
- ... 1197 more

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| api | 2 | 0 | 0 | 0 | 0 | 0 | 2 |
| file | 0 | 0 | 4 | 0 | 0 | 0 | 4 |
| schema | 0 | 49 | 4446 | 0 | 0 | 0 | 4495 |
| ui | 16 | 11 | 3 | 0 | 0 | 0 | 30 |

## By kind

- canvas-gesture: 1
- control: 15
- file-type: 4
- method: 2
- panel: 1
- property-group: 4
- region: 5
- schema-class: 1203
- schema-key: 3292
- tab: 3
- window: 1

## By risk

- mutating: 18
- safe: 4513

## Rows by kind

### canvas-gesture (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Config/canvas-gesture/Fill sub-config by drag-drop | T0/T2 | candidate: gui-automation, net-api-handler | none |

### control (15)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Config/control/#ancestorButton | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Config/control/#searchEditBox | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Config/control/@QPushButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Config/control/@QPushButton.2 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Config/control/Class | T1/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Config/control/Class label | T0/T5 | candidate: file-format, net-api-handler | none |
| ui:ResourceManager.Config/control/Edit value | T0/T5 | candidate: file-format, net-api-handler | none |
| ui:ResourceManager.Config/control/Parent | T1/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Config/control/Parent button | T0/T5 | candidate: file-format, net-api-handler | none |
| ui:ResourceManager.Config/control/Reset value to default | T0/T5 | candidate: file-format, net-api-handler | none |
| ui:ResourceManager.Config/control/Resource Variants | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Config/control/Search Field | T1/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Config/control/Search field | T0/T5 | candidate: file-format, net-api-handler | none |
| ui:ResourceManager.Config/control/Values | T1/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Config/control/searchEditBox/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation | none |

### file-type (4)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| file:.conf | T2/T3 | candidate: file-format | [animation_find_unused_clips.run](../tools/animation_find_unused_clips.md) read, [asset_search.run](../tools/asset_search.md) read, [config_create.run](../tools/config_create.md) read, [config_edit.arrayAdd](../tools/config_edit.md) drive, [config_edit.arrayRemove](../tools/config_edit.md) drive, [config_edit.clear](../tools/config_edit.md) drive, [config_edit.createInherited](../tools/config_edit.md) drive, [config_edit.override](../tools/config_edit.md) drive, [config_edit.read](../tools/config_edit.md) read, [config_edit.set](../tools/config_edit.md) drive, [config_edit.setAncestor](../tools/config_edit.md) drive, [faction_create.run](../tools/faction_create.md) read, [faction_list_units.run](../tools/faction_list_units.md) read, [find_broken_refs.run](../tools/find_broken_refs.md) read, [find_references.run](../tools/find_references.md) read, [find_unused_resources.run](../tools/find_unused_resources.md) read, [game_browse.run](../tools/game_browse.md) read, [game_read.run](../tools/game_read.md) read, [gm_spawn_list_export.run](../tools/gm_spawn_list_export.md) read, [inheritance_chain.run](../tools/inheritance_chain.md) read, [list_resources.run](../tools/list_resources.md) read, [mod.create](../tools/mod.md) read, [mod.validate](../tools/mod.md) read, [navmesh.config](../tools/navmesh.md) read, [navmesh.overrideConfig](../tools/navmesh.md) drive, [navmesh.status](../tools/navmesh.md) read, [project_index_status.run](../tools/project_index_status.md) read, [project_validate.faction](../tools/project_validate.md) read, [project_validate.mod](../tools/project_validate.md) read, [project_validate.scenario](../tools/project_validate.md) read, [refactor_merge_duplicate_guids.run](../tools/refactor_merge_duplicate_guids.md) read, [refactor_move_resource_path.run](../tools/refactor_move_resource_path.md) read, [refactor_remove_unused.run](../tools/refactor_remove_unused.md) read, [refactor_replace_guid.run](../tools/refactor_replace_guid.md) read, [resolve_guid.run](../tools/resolve_guid.md) read, [scenario_clone_area.run](../tools/scenario_clone_area.md) read, [scenario_create_conflict.run](../tools/scenario_create_conflict.md) read, [scenario_diff.run](../tools/scenario_diff.md) read, [scenario_inspect.run](../tools/scenario_inspect.md) read, [server_scenario_picker.run](../tools/server_scenario_picker.md) read |
| file:.gamemat | T2/T3 | candidate: file-format | none |
| file:.physmat | T2/T3 | candidate: file-format | none |
| file:.vhcsurf | T2/T3 | candidate: file-format | none |

### method (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:method/Create config file | T0/T5 | candidate: file-format, net-api-handler | none |
| api:method/Create inherited config | T0/T5 | candidate: file-format, net-api-handler | none |

### panel (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Config/panel/#qt_tabwidget_tabbar | T2/T3 | candidate: gui-automation | none |

### property-group (4)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Config/property-group/@PropertyGridBC.1 | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Config/property-group/@PropertyGridBC.1/Effects | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Config/property-group/@PropertyGridBC.1/Secondary damage | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Config/property-group/@PropertyGridBC.1/Unsorted | T1/T3 | candidate: gui-automation | none |

### region (5)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Config/region/#ConfigEditorHierarchy | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Config/region/#configAncestorLabel | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Config/region/#configClassLabel | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Config/region/@QSplitterHandle.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Config/region/@QWidget.1 | T0/T2 | candidate: gui-automation | none |

### schema-class (1203)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:AIAmbientLightProbeSystem | T2/T2 | candidate: file-format | none |
| schema:AICarMovementComponentSerializer | T2/T2 | candidate: file-format | none |
| schema:AICenterOfMassSystem | T2/T2 | candidate: file-format | none |
| schema:AIControlComponentSerializer | T2/T2 | candidate: file-format | none |
| schema:AIDiagSystem | T2/T2 | candidate: file-format | none |
| schema:AIFlockUpdateSystem | T2/T2 | candidate: file-format | none |
| schema:AIFormationComponentSerializer | T2/T2 | candidate: file-format | none |
| schema:AIObstacleAvoidanceSystem | T2/T2 | candidate: file-format | none |
| schema:AIVehicleKnowledgeSystem | T2/T2 | candidate: file-format | none |
| schema:AIWaypointCycleSerializer | T2/T2 | candidate: file-format | none |
| schema:AIWorldSystem | T2/T2 | candidate: file-format | none |
| schema:Action | T2/T2 | candidate: file-format | none |
| schema:ActionContext | T2/T2 | candidate: file-format | none |
| schema:ActionManager | T2/T2 | candidate: file-format | none |
| schema:AnimateWidgetSystem | T2/T2 | candidate: file-format | none |
| schema:AnimationControllerSystem | T2/T2 | candidate: file-format | none |
| schema:AnimationPlayerSystem | T2/T2 | candidate: file-format | none |
| schema:AoeDamageSystem | T2/T2 | candidate: file-format | none |
| schema:AssetTypes | T2/T2 | candidate: file-format | none |
| schema:AudioVariableClass | T2/T2 | candidate: file-format | none |
| schema:AudioVariablesClass | T2/T2 | candidate: file-format | none |
| schema:AvailableActionEditorLayoutBehavior | T2/T2 | candidate: file-format | none |
| schema:AvailableActionMenuLayoutBehavior | T2/T2 | candidate: file-format | none |
| schema:BallisticGenerationConfig | T2/T2 | candidate: file-format | none |
| schema:BallisticInfo | T2/T2 | candidate: file-format | none |
| schema:BallisticTable | T2/T2 | candidate: file-format | none |
| schema:BallisticTableArray | T2/T2 | candidate: file-format | none |
| schema:BaseCompartmentManagerComponentSerializer | T2/T2 | candidate: file-format | none |
| schema:BaseInventoryStorageComponentSerializer | T2/T2 | candidate: file-format | none |
| schema:BaseLightManagerComponentSerializer | T2/T2 | candidate: file-format | none |
| schema:BaseRadioComponentSerializer | T2/T2 | candidate: file-format | none |
| schema:BehaviorTreeSystem | T2/T2 | candidate: file-format | none |
| schema:BirdAnimationsUpdateSystem | T2/T2 | candidate: file-format | none |
| schema:BuildableEntitySerializer | T2/T2 | candidate: file-format | none |
| schema:BuoyancySystem | T2/T2 | candidate: file-format | none |
| schema:CamerasSystem | T2/T2 | candidate: file-format | none |
| schema:CampaignBasesSystem | T2/T2 | candidate: file-format | none |
| schema:CarControllerComponentSerializer | T2/T2 | candidate: file-format | none |
| schema:CharacterControllerComponentSerializer | T2/T2 | candidate: file-format | none |
| schema:CharacterIgnoreDamageSystem | T2/T2 | candidate: file-format | none |

1163 more: wb_census find with module=ResourceManager.Config kind=schema-class.

### schema-key (3292)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:Action.InputSource | T2/T2 | candidate: file-format | none |
| schema:Action.Limit | T2/T2 | candidate: file-format | none |
| schema:Action.LimitMax | T2/T2 | candidate: file-format | none |
| schema:Action.LimitMin | T2/T2 | candidate: file-format | none |
| schema:Action.Transition | T2/T2 | candidate: file-format | none |
| schema:Action.Type | T2/T2 | candidate: file-format | none |
| schema:ActionContext.ActionRefs | T2/T2 | candidate: file-format | none |
| schema:ActionContext.Actions | T2/T2 | candidate: file-format | none |
| schema:ActionContext.Flags | T2/T2 | candidate: file-format | none |
| schema:ActionContext.Priority | T2/T2 | candidate: file-format | none |
| schema:ActionManager.Actions | T2/T2 | candidate: file-format | none |
| schema:ActionManager.Contexts | T2/T2 | candidate: file-format | none |
| schema:AssetTypes.m_aAssetTypes | T2/T2 | candidate: file-format | none |
| schema:AudioVariableClass.op | T2/T2 | candidate: file-format | none |
| schema:AudioVariableClass.source | T2/T2 | candidate: file-format | none |
| schema:AudioVariableClass.value | T2/T2 | candidate: file-format | none |
| schema:AudioVariableClass.value_max | T2/T2 | candidate: file-format | none |
| schema:AudioVariableClass.value_min | T2/T2 | candidate: file-format | none |
| schema:AudioVariablesClass.Variables | T2/T2 | candidate: file-format | none |
| schema:AvailableActionEditorLayoutBehavior.m_eEditorMode | T2/T2 | candidate: file-format | none |
| schema:AvailableActionEditorLayoutBehavior.m_fIllegalEditorOffset | T2/T2 | candidate: file-format | none |
| schema:AvailableActionEditorLayoutBehavior.m_fOffsetY | T2/T2 | candidate: file-format | none |
| schema:AvailableActionEditorLayoutBehavior.m_iPriority | T2/T2 | candidate: file-format | none |
| schema:AvailableActionMenuLayoutBehavior.m_ActiveMenu | T2/T2 | candidate: file-format | none |
| schema:AvailableActionMenuLayoutBehavior.m_fOffsetY | T2/T2 | candidate: file-format | none |
| schema:AvailableActionMenuLayoutBehavior.m_iPriority | T2/T2 | candidate: file-format | none |
| schema:BallisticGenerationConfig.GenerateDirectFireTables | T2/T2 | candidate: file-format | none |
| schema:BallisticGenerationConfig.GenerateIndirectFireTables | T2/T2 | candidate: file-format | none |
| schema:BallisticGenerationConfig.PreciseInitSpeedCoefficients | T2/T2 | candidate: file-format | none |
| schema:BallisticGenerationConfig.PrecisionErrorThresholdOfDirectFire | T2/T2 | candidate: file-format | none |
| schema:BallisticGenerationConfig.PrecisionErrorThresholdOfIndirectFire | T2/T2 | candidate: file-format | none |
| schema:BallisticInfo.AllowDeflection | T2/T2 | candidate: file-format | none |
| schema:BallisticInfo.CavitationDamageMultiplier | T2/T2 | candidate: file-format | none |
| schema:BallisticInfo.ChemicalPenetrationResistance | T2/T2 | candidate: file-format | none |
| schema:BallisticInfo.Density | T2/T2 | candidate: file-format | none |
| schema:BallisticInfo.GlassSurface | T2/T2 | candidate: file-format | none |
| schema:BallisticInfo.KineticPenetrationResistance | T2/T2 | candidate: file-format | none |
| schema:BallisticInfo.MushroomingDamageMultiplier | T2/T2 | candidate: file-format | none |
| schema:BallisticInfo.PenetrationDamageModel | T2/T2 | candidate: file-format | none |
| schema:BallisticInfo.PenetrationDirCombine | T2/T2 | candidate: file-format | none |

3252 more: wb_census find with module=ResourceManager.Config kind=schema-key.

### tab (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Config/tab/#DockingTabBar | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Config/tab/qt_tabwidget_tabbar/Details | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Config/tab/qt_tabwidget_tabbar/Import Settings | T1/T3 | candidate: gui-automation | none |

### window (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Config/window/Open config | T1/T3 | candidate: net-api-handler | none |

## Below target (85)

- T0 to T2: 6
- T0 to T3: 1
- T0 to T5: 11
- T1 to T2: 49
- T1 to T3: 7
- T1 to T5: 4
- T2 to T3: 5
- T2 to T5: 2

| id | tier | path |
| --- | --- | --- |
| api:method/Create config file | T0/T5 | candidate: file-format, net-api-handler |
| api:method/Create inherited config | T0/T5 | candidate: file-format, net-api-handler |
| file:.conf | T2/T3 | candidate: file-format |
| file:.gamemat | T2/T3 | candidate: file-format |
| file:.physmat | T2/T3 | candidate: file-format |
| file:.vhcsurf | T2/T3 | candidate: file-format |
| schema:PacejkaAligning | T1/T2 | candidate: file-format |
| schema:PacejkaAligning.c0 | T1/T2 | candidate: file-format |
| schema:PacejkaAligning.c1 | T1/T2 | candidate: file-format |
| schema:PacejkaAligning.c10 | T1/T2 | candidate: file-format |
| schema:PacejkaAligning.c11 | T1/T2 | candidate: file-format |
| schema:PacejkaAligning.c12 | T1/T2 | candidate: file-format |
| schema:PacejkaAligning.c13 | T1/T2 | candidate: file-format |
| schema:PacejkaAligning.c14 | T1/T2 | candidate: file-format |
| schema:PacejkaAligning.c16 | T1/T2 | candidate: file-format |
| schema:PacejkaAligning.c17 | T1/T2 | candidate: file-format |
| schema:PacejkaAligning.c18 | T1/T2 | candidate: file-format |
| schema:PacejkaAligning.c2 | T1/T2 | candidate: file-format |
| schema:PacejkaAligning.c3 | T1/T2 | candidate: file-format |
| schema:PacejkaAligning.c4 | T1/T2 | candidate: file-format |
| schema:PacejkaAligning.c5 | T1/T2 | candidate: file-format |
| schema:PacejkaAligning.c6 | T1/T2 | candidate: file-format |
| schema:PacejkaAligning.c7 | T1/T2 | candidate: file-format |
| schema:PacejkaAligning.c8 | T1/T2 | candidate: file-format |
| schema:PacejkaAligning.c9 | T1/T2 | candidate: file-format |
| schema:PacejkaLateral | T1/T2 | candidate: file-format |
| schema:PacejkaLateral.a0 | T1/T2 | candidate: file-format |
| schema:PacejkaLateral.a1 | T1/T2 | candidate: file-format |
| schema:PacejkaLateral.a10 | T1/T2 | candidate: file-format |
| schema:PacejkaLateral.a11 | T1/T2 | candidate: file-format |
| schema:PacejkaLateral.a12 | T1/T2 | candidate: file-format |
| schema:PacejkaLateral.a13 | T1/T2 | candidate: file-format |
| schema:PacejkaLateral.a14 | T1/T2 | candidate: file-format |
| schema:PacejkaLateral.a2 | T1/T2 | candidate: file-format |
| schema:PacejkaLateral.a3 | T1/T2 | candidate: file-format |
| schema:PacejkaLateral.a4 | T1/T2 | candidate: file-format |
| schema:PacejkaLateral.a5 | T1/T2 | candidate: file-format |
| schema:PacejkaLateral.a6 | T1/T2 | candidate: file-format |
| schema:PacejkaLateral.a7 | T1/T2 | candidate: file-format |
| schema:PacejkaLateral.a8 | T1/T2 | candidate: file-format |
| schema:PacejkaLateral.a9 | T1/T2 | candidate: file-format |
| schema:PacejkaLongitudinal | T1/T2 | candidate: file-format |
| schema:PacejkaLongitudinal.b0 | T1/T2 | candidate: file-format |
| schema:PacejkaLongitudinal.b1 | T1/T2 | candidate: file-format |
| schema:PacejkaLongitudinal.b10 | T1/T2 | candidate: file-format |
| schema:PacejkaLongitudinal.b2 | T1/T2 | candidate: file-format |
| schema:PacejkaLongitudinal.b3 | T1/T2 | candidate: file-format |
| schema:PacejkaLongitudinal.b4 | T1/T2 | candidate: file-format |
| schema:PacejkaLongitudinal.b5 | T1/T2 | candidate: file-format |
| schema:PacejkaLongitudinal.b6 | T1/T2 | candidate: file-format |
| schema:PacejkaLongitudinal.b7 | T1/T2 | candidate: file-format |
| schema:PacejkaLongitudinal.b8 | T1/T2 | candidate: file-format |
| schema:PacejkaLongitudinal.b9 | T1/T2 | candidate: file-format |
| schema:SCR_LoiterCustomAnimData.m_eLoiterItemPreset | T1/T2 | candidate: file-format |
| schema:VehiclesDustSystem | T1/T2 | candidate: file-format |
| ui:ResourceManager.Config/canvas-gesture/Fill sub-config by drag-drop | T0/T2 | candidate: gui-automation, net-api-handler |
| ui:ResourceManager.Config/control/#ancestorButton | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Config/control/#searchEditBox | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Config/control/@QPushButton.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Config/control/@QPushButton.2 | T0/T5 | candidate: gui-automation |

25 more: wb_census find with module=ResourceManager.Config.

## Dispositions (0)

No row of this module carries a disposition.
