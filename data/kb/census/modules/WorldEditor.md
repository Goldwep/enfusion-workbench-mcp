# Census: WorldEditor

5208 rows (13 aggregate excluded).

## What it is

Module WorldEditor: api 1126, cli 10, file 26, link 2, mcp 305, net 27, plugin 374, schema 1969, setting 323, ui 1046. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- class BakeMlodTool (api:BakeMlodTool)
- class BuildShoreMapWEPlugin (api:BuildShoreMapWEPlugin)
- class CameraOrientationTool (api:CameraOrientationTool)
- class DedicatedServerPluginCLI (api:DedicatedServerPluginCLI)
- class DedicatedServerPluginCLI_Config (api:DedicatedServerPluginCLI_Config)
- class DedicatedServerPluginCLI_Server (api:DedicatedServerPluginCLI_Server)
- class EditorPlugin (api:EditorPlugin)
- class EntityOrientationTool (api:EntityOrientationTool)
- class EntityRelativePlugin (api:EntityRelativePlugin)
- class EntityReplacerTool_ReplaceWith (api:EntityReplacerTool_ReplaceWith)
- class EntityReplacerTool_ToReplace (api:EntityReplacerTool_ToReplace)
- class GameModeSetupConfig (api:GameModeSetupConfig)
- ... 1741 more

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| api | 95 | 5 | 921 | 9 | 3 | 93 | 1126 |
| cli | 9 | 0 | 1 | 0 | 0 | 0 | 10 |
| file | 13 | 0 | 13 | 0 | 0 | 0 | 26 |
| link | 0 | 1 | 1 | 0 | 0 | 0 | 2 |
| mcp | 22 | 2 | 95 | 64 | 3 | 119 | 305 |
| net | 0 | 0 | 23 | 4 | 0 | 0 | 27 |
| plugin | 68 | 0 | 306 | 0 | 0 | 0 | 374 |
| schema | 0 | 1422 | 547 | 0 | 0 | 0 | 1969 |
| setting | 323 | 0 | 0 | 0 | 0 | 0 | 323 |
| ui | 199 | 274 | 527 | 6 | 0 | 40 | 1046 |

## By kind

- attribute: 69
- canvas-gesture: 41
- class: 137
- cli-switch: 10
- context-item: 94
- context-menu: 6
- control: 200
- dialog: 3
- dock: 11
- enum: 8
- enum-value: 32
- event: 18
- file-type: 26
- handler-action: 155
- hazard-dialog: 1
- link-format: 2
- mcp-action: 120
- mcp-tool: 30
- menu: 36
- menu-item: 187
- method: 760
- module: 1
- net-field: 21
- net-handler: 6
- option: 110
- panel: 37
- plugin: 109
- plugin-button: 50
- plugin-cli-arg: 4
- plugin-setting: 205
- property: 5
- property-group: 25
- region: 48
- schema-class: 1540
- schema-key: 429
- setting-key: 311
- shortcut: 128
- static-method: 102
- status-item: 4
- tab: 21
- tool: 33
- toolbar: 14
- toolbar-button: 58
- window: 1

## By risk

- credential: 3
- destructive: 23
- mutating: 2404
- safe: 2778

## Rows by kind

### attribute (69)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:DedicatedServerPluginCLI_Config#attr:m_Config | T2/T2 | candidate: net-api-handler | none |
| api:DedicatedServerPluginCLI_Server#attr:m_MissionHeader | T2/T2 | candidate: net-api-handler | none |
| api:DedicatedServerPluginCLI_Server#attr:m_SystemsConfig | T2/T2 | candidate: net-api-handler | none |
| api:DedicatedServerPluginCLI_Server#attr:m_World | T2/T2 | candidate: net-api-handler | none |
| api:DedicatedServerPluginCLI_Server#attr:m_sAdminPassword | T2/T2 | candidate: net-api-handler | none |
| api:EntityReplacerTool_ReplaceWith#attr:m_fReplacementWeight | T2/T2 | candidate: net-api-handler | none |
| api:EntityReplacerTool_ReplaceWith#attr:m_sResourceName | T2/T2 | candidate: net-api-handler | none |
| api:EntityReplacerTool_ToReplace#attr:m_fReplacementPercentage | T2/T2 | candidate: net-api-handler | none |
| api:EntityReplacerTool_ToReplace#attr:m_sResourceName | T2/T2 | candidate: net-api-handler | none |
| api:GameModeSetupConfig#attr:m_MissionHeader | T2/T2 | candidate: net-api-handler | none |
| api:GameModeSetupConfig#attr:m_Prefabs | T2/T2 | candidate: net-api-handler | none |
| api:GameModeSetupConfigEntry#attr:m_Comment | T2/T2 | candidate: net-api-handler | none |
| api:GameModeSetupConfigEntry#attr:m_Prefab | T2/T2 | candidate: net-api-handler | none |
| api:SCR_BatchPrefabTemplates#attr:m_AttributesArray | T2/T2 | candidate: net-api-handler | none |
| api:SCR_BatchPrefabTemplates#attr:m_ComponentsArray | T2/T2 | candidate: net-api-handler | none |
| api:SCR_BatchPrefabTemplatesAttributes#attr:m_AttributeName | T2/T2 | candidate: net-api-handler | none |
| api:SCR_BatchPrefabTemplatesAttributes#attr:m_AttributeOperation | T2/T2 | candidate: net-api-handler | none |
| api:SCR_BatchPrefabTemplatesAttributes#attr:m_AttributeValue | T2/T2 | candidate: net-api-handler | none |
| api:SCR_BatchPrefabTemplatesAttributes#attr:m_SubAttributesArray | T2/T2 | candidate: net-api-handler | none |
| api:SCR_BatchPrefabTemplatesData#attr:m_ComponentAction | T2/T2 | candidate: net-api-handler | none |
| api:SCR_BatchPrefabTemplatesData#attr:m_ComponentAttributesArray | T2/T2 | candidate: net-api-handler | none |
| api:SCR_BatchPrefabTemplatesData#attr:m_ComponentName | T2/T2 | candidate: net-api-handler | none |
| api:SCR_BuildingDestructionSetupToolConfig#attr:m_aEffects | T2/T2 | candidate: net-api-handler | none |
| api:SCR_CoordsTool_CoordsEntry#attr:m_sLink | T2/T2 | candidate: net-api-handler | none |
| api:SCR_CoordsTool_CoordsEntry#attr:m_sName | T2/T2 | candidate: net-api-handler | none |
| api:SCR_FloatersFixerPlugin#attr:m_bAlignToNormalOverride | T2/T2 | candidate: net-api-handler | none |
| api:SCR_FloatersFixerPlugin#attr:m_bSetOnTerrainAndEntitiesSurface | T2/T2 | candidate: net-api-handler | none |
| api:SCR_FloatersFixerPlugin#attr:m_bUsePrefabAlignToNormal | T2/T2 | candidate: net-api-handler | none |
| api:SCR_FloatersFixerPlugin#attr:m_bUsePrefabVerticalOffset | T2/T2 | candidate: net-api-handler | none |
| api:SCR_FloatersFixerPlugin#attr:m_iTraceOriginDistance | T2/T2 | candidate: net-api-handler | none |
| api:SCR_MassResponseIndexPair#attr:m_fMass | T2/T2 | candidate: net-api-handler | none |
| api:SCR_MassResponseIndexPair#attr:m_iIndex | T2/T2 | candidate: net-api-handler | none |
| api:SCR_MassResponseIndexPair#attr:m_sIndexName | T2/T2 | candidate: net-api-handler | none |
| api:SCR_ObjectBrushArrayConfig#attr:m_aObjectArray | T2/T2 | candidate: net-api-handler | none |
| api:SCR_ObjectBrushObjectBase#attr:m_bAlignToNormal | T2/T2 | candidate: net-api-handler | none |
| api:SCR_ObjectBrushObjectBase#attr:m_bOverrideRandomization | T2/T2 | candidate: net-api-handler | none |
| api:SCR_ObjectBrushObjectBase#attr:m_bScaleFalloff | T2/T2 | candidate: net-api-handler | none |
| api:SCR_ObjectBrushObjectBase#attr:m_fLowestScaleFalloffValue | T2/T2 | candidate: net-api-handler | none |
| api:SCR_ObjectBrushObjectBase#attr:m_fMaxRandomVerticalOffset | T2/T2 | candidate: net-api-handler | none |
| api:SCR_ObjectBrushObjectBase#attr:m_fMinRandomVerticalOffset | T2/T2 | candidate: net-api-handler | none |

29 more: wb_census find with module=WorldEditor kind=attribute.

### canvas-gesture (41)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:WorldEditor/canvas-gesture/Rotate Tool/Holding Ctrl while rotating | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/Rotate Tool/duplicate the element and rotate the copy | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_EntityReplacerTool/MousePress ALT+LEFT | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_EntityReplacerTool/MousePress CONTROL+LEFT | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_EntityReplacerTool/MousePress CONTROL+SHIFT+LEFT | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_EntityReplacerTool/MousePress LEFT | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_EntityReplacerTool/MousePress SHIFT+ALT+LEFT | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_EntityReplacerTool/MousePress SHIFT+LEFT | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_ObjectBrushTool/KeyPress KC_ESCAPE | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_ObjectBrushTool/KeyPress KC_SPACE | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_ObjectBrushTool/KeyRelease KC_SPACE | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_ObjectBrushTool/MouseMove | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_ObjectBrushTool/MousePress ALT+LEFT | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_ObjectBrushTool/MousePress LEFT | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_ObjectBrushTool/MouseRelease LEFT | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_ObjectBrushTool/Wheel CONTROL | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_ObjectBrushTool/Wheel SHIFT | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_SelectionBrushTool/KeyPress KC_DELETE | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_SelectionBrushTool/KeyPress KC_ESCAPE | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_SelectionBrushTool/KeyPress KC_SPACE | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_SelectionBrushTool/KeyRelease KC_SPACE | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_SelectionBrushTool/MouseMove | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_SelectionBrushTool/MouseMove SHIFT | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_SelectionBrushTool/MousePress CONTROL+LEFT | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_SelectionBrushTool/MousePress LEFT | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_SelectionBrushTool/MousePress SHIFT+LEFT | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_SelectionBrushTool/MouseRelease LEFT | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/SCR_SelectionBrushTool/Wheel CONTROL | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/Terrain Creation Tool/Sculpt/Set angle | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/Terrain Creation Tool/Sculpt/Set falloff | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/Terrain Creation Tool/Sculpt/Set radius | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/Terrain Creation Tool/Sculpt/Set strength%2Fheight | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/Vector Tool/adds a point after the selected one | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/Vector Tool/adds a point before the selected one | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/Viewport/Use the A and D keys to move the camera sideways | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/Viewport/Use the Q and Z keys to move the camera up and down | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/Viewport/Use the W and S keys to move the camera forward and backward | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/Viewport/change the orientation of the camera | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/Viewport/changes the speed at which the camera moves | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/canvas-gesture/Viewport/focuses on the currently selected entity | T1/T2 | candidate: gui-automation | none |

1 more: wb_census find with module=WorldEditor kind=canvas-gesture.

### class (137)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:BakeMlodTool | T2/T2 | candidate: none-known | none |
| api:BuildShoreMapWEPlugin | T2/T2 | candidate: none-known | none |
| api:CameraOrientationTool | T2/T2 | candidate: none-known | none |
| api:DedicatedServerPluginCLI | T2/T2 | candidate: none-known | none |
| api:DedicatedServerPluginCLI_Config | T2/T2 | candidate: none-known | none |
| api:DedicatedServerPluginCLI_Server | T2/T2 | candidate: none-known | none |
| api:EditorPlugin | T2/T2 | candidate: none-known | none |
| api:EntityOrientationTool | T2/T2 | candidate: none-known | none |
| api:EntityRelativePlugin | T2/T2 | candidate: none-known | none |
| api:EntityReplacerTool_ReplaceWith | T2/T2 | candidate: none-known | none |
| api:EntityReplacerTool_ToReplace | T2/T2 | candidate: none-known | none |
| api:GameModeSetupConfig | T2/T2 | candidate: none-known | none |
| api:GameModeSetupConfigEntry | T2/T2 | candidate: none-known | none |
| api:GenerateFlowMapsWEPlugin | T2/T2 | candidate: none-known | none |
| api:MeasureTool | T2/T2 | candidate: none-known | none |
| api:PeerPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_AddPrefabToSelectedEntitiesPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_AutoSpawnerTool | T2/T2 | candidate: none-known | none |
| api:SCR_BatchPrefabTemplates | T2/T2 | candidate: none-known | none |
| api:SCR_BatchPrefabTemplatesAttributes | T2/T2 | candidate: none-known | none |
| api:SCR_BatchPrefabTemplatesData | T2/T2 | candidate: none-known | none |
| api:SCR_BatchPrefabTitle | T2/T2 | candidate: none-known | none |
| api:SCR_BatchPrefabsOperationsTool | T2/T2 | candidate: none-known | none |
| api:SCR_BuildingDestructionSetupTool | T2/T2 | candidate: none-known | none |
| api:SCR_BuildingDestructionSetupToolConfig | T2/T2 | candidate: none-known | none |
| api:SCR_CoordsTool | T2/T2 | candidate: none-known | none |
| api:SCR_CoordsTool_CoordsEntry | T2/T2 | candidate: none-known | none |
| api:SCR_CreateEditablePrefabsPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_DamageAreaShapesPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_DedicatedServerPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_DestructiblePrefabFinderTool | T2/T2 | candidate: none-known | none |
| api:SCR_DestructionIndicesAssignTool | T2/T2 | candidate: none-known | none |
| api:SCR_EntityFlagsManagerPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_EntityReplacerTool | T2/T2 | candidate: none-known | none |
| api:SCR_EntitySourceHelper | T2/T2 | candidate: none-known | none |
| api:SCR_EntitySpawnerPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_ExportGeoDataPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_FPSDiagnosticPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_FloatersFinderPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_FloatersFixerPlugin | T2/T2 | candidate: none-known | none |

97 more: wb_census find with module=WorldEditor kind=class.

### cli-switch (10)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| cli:-forcesaveall | T2/T5 | candidate: cli | [wb_cli_run.forceSaveAll](../tools/wb_cli_run.md) drive |
| cli:cli-switch/Build shore map | T0/T5 | candidate: cli | none |
| cli:cli-switch/Force Save All | T0/T2 | candidate: cli | none |
| cli:cli-switch/Navmesh generation | T0/T5 | candidate: cli | none |
| cli:cli-switch/Open World Editor with a world | T0/T5 | candidate: cli | none |
| cli:cli-switch/Open a view link | T0/T5 | candidate: cli | none |
| cli:cli-switch/Regenerate flow maps | T0/T5 | candidate: cli | none |
| cli:cli-switch/Terrain entity variant replacement | T0/T5 | candidate: cli | none |
| cli:cli-switch/World data export | T0/T5 | candidate: cli, net-api-handler | none |
| cli:cli-switch/World smoke test | T0/T5 | candidate: cli | none |

### context-item (94)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:WorldEditor/context-item/Hierarchy/default/Delete | T2/T2 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/default/Disable | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/default/Expand all | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/default/Lock | T5/T5 | net-api-handler | [wb_layers.lock](../tools/wb_layers.md) drive |
| ui:WorldEditor/context-item/Hierarchy/default/Rename | T5/T5 | net-api-handler | [wb_layers.rename](../tools/wb_layers.md) drive |
| ui:WorldEditor/context-item/Hierarchy/default/Save | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/default/Select all entities | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/default/Set as active | T5/T5 | net-api-handler | [wb_layers.setActive](../tools/wb_layers.md) drive |
| ui:WorldEditor/context-item/Hierarchy/entity/@QWidgetAction.1 | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/@QWidgetAction.2 | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/@QWidgetAction.3 | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Add Child Prefab | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Apply Changes to Prefab | T5/T5 | net-api-handler | [wb_prefabs.save](../tools/wb_prefabs.md) drive |
| ui:WorldEditor/context-item/Hierarchy/entity/Break Prefab Instance | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Copy Name | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Create Prefab Instance | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Delete | T2/T2 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Expand all | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Focus Selection | T5/T5 | net-api-handler | [wb_view.focus](../tools/wb_view.md) drive |
| ui:WorldEditor/context-item/Hierarchy/entity/Hide All Except Selected | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Hide%2FShow | T5/T5 | net-api-handler | [wb_view.setVisible](../tools/wb_view.md) drive |
| ui:WorldEditor/context-item/Hierarchy/entity/Jump to Script Definition | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Locate Nested Prefab | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Locate Prefab | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Locate Prefab in Library | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Open Mesh in Material Editor | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Open Nested Prefab | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Open Prefab | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Place Using Physics | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Remove from Parent | T5/T5 | net-api-handler | [wb_entity.unparent](../tools/wb_entity.md) drive |
| ui:WorldEditor/context-item/Hierarchy/entity/Rename | T5/T5 | net-api-handler | [wb_entity.rename](../tools/wb_entity.md) drive |
| ui:WorldEditor/context-item/Hierarchy/entity/Replace with Prefab | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Select Children | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Select Layer | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Select Parent | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Select Prefab Instance Members | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Select Prefab Instance Root | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Select Siblings | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/context-item/Hierarchy/entity/Set Layer | T5/T5 | net-api-handler | [wb_entity.setLayer](../tools/wb_entity.md) drive |
| ui:WorldEditor/context-item/Hierarchy/entity/Set Parent | T5/T5 | net-api-handler | [wb_entity.parent](../tools/wb_entity.md) drive |

54 more: wb_census find with module=WorldEditor kind=context-item.

### context-menu (6)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:WorldEditor/context-menu/Create new terrain | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/context-menu/Hierarchy/default | T0/T3 | candidate: gui-automation | [wb_gui.context](../tools/wb_gui.md) read |
| ui:WorldEditor/context-menu/Hierarchy/entity | T0/T3 | candidate: gui-automation | [wb_gui.context](../tools/wb_gui.md) read |
| ui:WorldEditor/context-menu/Hierarchy/world | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/context-menu/Resource Browser/folder | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/context-menu/Viewport | T0/T3 | candidate: gui-automation | none |

### control (200)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:WorldEditor/control/#DragElementCombo | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#DropElementCombo | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#ExtraRotXEdit | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#ExtraRotYEdit | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#ExtraRotZEdit | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#Maximize-Restore | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#Minimize-Restore | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#RotSnapModeCombo | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#addComponentButton | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#applyToPrefabButton | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#cancelButton | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#componentFilter | T0/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#componentTree | T0/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#createDockFilter | T0/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#createTree | T0/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#entityFilterButton | T0/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#entityFilterEdit | T0/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#entityOptionsButton | T0/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#entityTree | T0/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#fileNameEdit | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#gotoTopLevelStorageObjectButton | T0/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#locatePrefabFileButton | T0/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#mumMoveMinusButton | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#mumMovePlusButton | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#mumMoveXEdit | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#mumMoveYEdit | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#mumMoveZEdit | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#newFolderButton | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#okButton | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#propFilter | T0/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#selectedObjectName | T0/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#showComponentHierarchyButton | T0/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#snapToGridGroupBox | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#snapToGridXButton | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#snapToGridXEdit | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#snapToGridYButton | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#snapToGridYEdit | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#snapToGridZButton | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#snapToGridZEdit | T2/T5 | candidate: gui-automation | none |
| ui:WorldEditor/control/#toolButtonLeft | T0/T5 | candidate: gui-automation | none |

160 more: wb_census find with module=WorldEditor kind=control.

### dialog (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:WorldEditor/dialog/#FileDlg | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/dialog/#createWorldDialog | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/dialog/User Profile | T2/T3 | candidate: gui-automation | none |

### dock (11)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:WorldEditor/dock/#cinematicsDock | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/dock/#createDock | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/dock/#currentToolDock | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/dock/#entityPropDock | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/dock/#entityTreeDock | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/dock/#logConsoleDock | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/dock/#minimapDock | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/dock/#ragdollEditDock | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/dock/#resourcesDock | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/dock/#resourcesDock2 | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/dock/#templateLibraryDock | T2/T3 | candidate: gui-automation | none |

### enum (8)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:SCR_EBatchPrefabOperationComponentFlag | T2/T2 | candidate: none-known | none |
| api:SCR_EBatchPrefabOperationFlag | T2/T2 | candidate: none-known | none |
| api:SCR_EGameModeSetupButton | T2/T2 | candidate: none-known | none |
| api:SCR_EGameModeSetupPage | T2/T2 | candidate: none-known | none |
| api:SCR_EGeoExportType | T2/T2 | candidate: none-known | none |
| api:SCR_EMapDataExportType | T2/T2 | candidate: none-known | none |
| api:SCR_ESelectionBrushToolLayer | T2/T2 | candidate: none-known | none |
| api:SCR_ETerrainEntityVariant | T2/T2 | candidate: none-known | none |

### enum-value (32)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:SCR_EBatchPrefabOperationComponentFlag.CREATE | T2/T2 | candidate: none-known | none |
| api:SCR_EBatchPrefabOperationComponentFlag.DELETE | T2/T2 | candidate: none-known | none |
| api:SCR_EBatchPrefabOperationComponentFlag.MODIFY | T2/T2 | candidate: none-known | none |
| api:SCR_EBatchPrefabOperationFlag.ENUM | T2/T2 | candidate: none-known | none |
| api:SCR_EBatchPrefabOperationFlag.MATH | T2/T2 | candidate: none-known | none |
| api:SCR_EBatchPrefabOperationFlag.REPLACE | T2/T2 | candidate: none-known | none |
| api:SCR_EGameModeSetupButton.BACK | T2/T2 | candidate: none-known | none |
| api:SCR_EGameModeSetupButton.CANCEL | T2/T2 | candidate: none-known | none |
| api:SCR_EGameModeSetupButton.NEXT | T2/T2 | candidate: none-known | none |
| api:SCR_EGameModeSetupButton.SKIP | T2/T2 | candidate: none-known | none |
| api:SCR_EGameModeSetupButton.VALIDATE | T2/T2 | candidate: none-known | none |
| api:SCR_EGameModeSetupPage.GENERATION | T2/T2 | candidate: none-known | none |
| api:SCR_EGameModeSetupPage.GENERATION_RESULTS | T2/T2 | candidate: none-known | none |
| api:SCR_EGameModeSetupPage.INTRO | T2/T2 | candidate: none-known | none |
| api:SCR_EGameModeSetupPage.MISSION_HEADER | T2/T2 | candidate: none-known | none |
| api:SCR_EGameModeSetupPage.MISSION_HEADER_RESULTS | T2/T2 | candidate: none-known | none |
| api:SCR_EGameModeSetupPage.OUTRO | T2/T2 | candidate: none-known | none |
| api:SCR_EGameModeSetupPage.VALIDATION | T2/T2 | candidate: none-known | none |
| api:SCR_EGameModeSetupPage.VALIDATION_RESULTS | T2/T2 | candidate: none-known | none |
| api:SCR_EGeoExportType.GEO_JSON | T2/T2 | candidate: none-known | none |
| api:SCR_EGeoExportType.SVG | T2/T2 | candidate: none-known | none |
| api:SCR_EMapDataExportType.GEOMETRY_2D | T2/T2 | candidate: none-known | none |
| api:SCR_EMapDataExportType.RASTERIZATION | T2/T2 | candidate: none-known | none |
| api:SCR_EMapDataExportType.SOUNDMAP | T2/T2 | candidate: none-known | none |
| api:SCR_ESelectionBrushToolLayer.ALL_LAYERS | T2/T2 | candidate: none-known | none |
| api:SCR_ESelectionBrushToolLayer.CURRENT_LAYER | T2/T2 | candidate: none-known | none |
| api:SCR_ESelectionBrushToolLayer.INACTIVE_LAYERS | T2/T2 | candidate: none-known | none |
| api:SCR_ETerrainEntityVariant.AUTUMN | T2/T2 | candidate: none-known | none |
| api:SCR_ETerrainEntityVariant.DEFAULT | T2/T2 | candidate: none-known | none |
| api:SCR_ETerrainEntityVariant.SPRING | T2/T2 | candidate: none-known | none |
| api:SCR_ETerrainEntityVariant.SUMMER | T2/T2 | candidate: none-known | none |
| api:SCR_ETerrainEntityVariant.WINTER | T2/T2 | candidate: none-known | none |

### event (18)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:WorldEditorPlugin.OnGameModeEnded/0 | T5/T5 | net-api-handler | [wb_world.playEvents](../tools/wb_world.md) drive |
| api:WorldEditorPlugin.OnGameModeStarted/5 | T5/T5 | net-api-handler | [wb_world.playEvents](../tools/wb_world.md) drive |
| api:WorldEditorPlugin.OnWorldEditWindowDataDropped/5 | T2/T5 | candidate: net-api-handler | none |
| api:WorldEditorTool.OnActivate/0 | T2/T5 | candidate: net-api-handler | none |
| api:WorldEditorTool.OnAfterLoadWorld/0 | T2/T5 | candidate: net-api-handler | none |
| api:WorldEditorTool.OnBeforeUnloadWorld/0 | T2/T5 | candidate: net-api-handler | none |
| api:WorldEditorTool.OnDeActivate/0 | T2/T5 | candidate: net-api-handler | none |
| api:WorldEditorTool.OnEnterEvent/0 | T2/T5 | candidate: net-api-handler | none |
| api:WorldEditorTool.OnKeyPressEvent/2 | T2/T5 | candidate: net-api-handler | none |
| api:WorldEditorTool.OnKeyReleaseEvent/2 | T2/T5 | candidate: net-api-handler | none |
| api:WorldEditorTool.OnLeaveEvent/0 | T2/T5 | candidate: net-api-handler | none |
| api:WorldEditorTool.OnMouseDoubleClickEvent/3 | T2/T5 | candidate: net-api-handler | none |
| api:WorldEditorTool.OnMouseMoveEvent/2 | T2/T5 | candidate: net-api-handler | none |
| api:WorldEditorTool.OnMousePressEvent/3 | T2/T5 | candidate: net-api-handler | none |
| api:WorldEditorTool.OnMouseReleaseEvent/3 | T2/T5 | candidate: net-api-handler | none |
| api:WorldEditorTool.OnWheelEvent/1 | T2/T5 | candidate: net-api-handler | none |
| api:event/Entity editor callbacks | T0/T5 | candidate: net-api-handler | none |
| api:event/Play-mode events | T0/T5 | candidate: net-api-handler | none |

### file-type (26)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| file:.asc | T2/T3 | candidate: file-format | none |
| file:.bterr | T2/T3 | candidate: file-format | none |
| file:.bttile | T2/T3 | candidate: file-format | none |
| file:.ct | T2/T3 | candidate: file-format | none |
| file:.desc | T2/T3 | candidate: file-format | none |
| file:.ent | T2/T3 | candidate: file-format | [find_broken_refs.run](../tools/find_broken_refs.md) read, [find_references.run](../tools/find_references.md) read, [find_unused_resources.run](../tools/find_unused_resources.md) read, [inheritance_chain.run](../tools/inheritance_chain.md) read, [list_resources.run](../tools/list_resources.md) read, [project_index_status.run](../tools/project_index_status.md) read, [project_validate.scenario](../tools/project_validate.md) read, [refactor_merge_duplicate_guids.run](../tools/refactor_merge_duplicate_guids.md) read, [refactor_move_resource_path.run](../tools/refactor_move_resource_path.md) read, [refactor_remove_unused.run](../tools/refactor_remove_unused.md) read, [refactor_replace_guid.run](../tools/refactor_replace_guid.md) read, [resolve_guid.run](../tools/resolve_guid.md) read, [scenario_apply_template.run](../tools/scenario_apply_template.md) read, [scenario_clone_area.run](../tools/scenario_clone_area.md) read, [scenario_create_conflict.run](../tools/scenario_create_conflict.md) read, [scenario_inspect.run](../tools/scenario_inspect.md) read, [world_compose_summary.run](../tools/world_compose_summary.md) read, [world_diff.run](../tools/world_diff.md) read, [world_validate_refs.run](../tools/world_validate_refs.md) read |
| file:.et | T2/T3 | candidate: file-format | [asset_search.run](../tools/asset_search.md) read, [building_setup.run](../tools/building_setup.md) read, [faction_list_units.run](../tools/faction_list_units.md) read, [find_broken_refs.run](../tools/find_broken_refs.md) read, [find_references.run](../tools/find_references.md) read, [find_unused_resources.run](../tools/find_unused_resources.md) read, [game_browse.run](../tools/game_browse.md) read, [game_read.run](../tools/game_read.md) read, [inheritance_chain.run](../tools/inheritance_chain.md) read, [list_resources.run](../tools/list_resources.md) read, [mod.validate](../tools/mod.md) read, [prefab.create](../tools/prefab.md) read, [prefab.inspect](../tools/prefab.md) read, [project_index_status.run](../tools/project_index_status.md) read, [refactor_merge_duplicate_guids.run](../tools/refactor_merge_duplicate_guids.md) read, [refactor_move_resource_path.run](../tools/refactor_move_resource_path.md) read, [refactor_remove_unused.run](../tools/refactor_remove_unused.md) read, [refactor_replace_guid.run](../tools/refactor_replace_guid.md) read, [resolve_guid.run](../tools/resolve_guid.md) read, [scenario_apply_template.run](../tools/scenario_apply_template.md) read |
| file:.gproj | T2/T3 | candidate: file-format | [find_broken_refs.run](../tools/find_broken_refs.md) read, [find_references.run](../tools/find_references.md) read, [find_unused_resources.run](../tools/find_unused_resources.md) read, [inheritance_chain.run](../tools/inheritance_chain.md) read, [list_dependencies.run](../tools/list_dependencies.md) read, [list_resources.run](../tools/list_resources.md) read, [mod.create](../tools/mod.md) read, [mod.validate](../tools/mod.md) read, [navmesh.projects](../tools/navmesh.md) read, [project_index_status.run](../tools/project_index_status.md) read, [project_settings.addDependency](../tools/project_settings.md) drive, [project_settings.addPlatform](../tools/project_settings.md) drive, [project_settings.read](../tools/project_settings.md) read, [project_settings.removeDependency](../tools/project_settings.md) drive, [project_settings.removePlatform](../tools/project_settings.md) drive, [project_settings.set](../tools/project_settings.md) drive, [project_validate.faction](../tools/project_validate.md) read, [project_validate.mod](../tools/project_validate.md) read, [project_validate.scenario](../tools/project_validate.md) read, [refactor_move_resource_path.run](../tools/refactor_move_resource_path.md) read, [refactor_normalize_dependencies.run](../tools/refactor_normalize_dependencies.md) read, [refactor_remove_unused.run](../tools/refactor_remove_unused.md) read, [refactor_rename_project_id.run](../tools/refactor_rename_project_id.md) read, [refactor_replace_guid.run](../tools/refactor_replace_guid.md) read, [resolve_guid.run](../tools/resolve_guid.md) read, [ui_localization_audit.run](../tools/ui_localization_audit.md) read, [wb_cleanup.run](../tools/wb_cleanup.md) read, [workshop_check_deps.run](../tools/workshop_check_deps.md) read, [workshop_info.run](../tools/workshop_info.md) read, [workshop_validate_manifest.run](../tools/workshop_validate_manifest.md) read |
| file:.layer | T2/T3 | candidate: file-format | [scenario_apply_template.run](../tools/scenario_apply_template.md) read, [scenario_clone_area.run](../tools/scenario_clone_area.md) read, [scenario_create_conflict.run](../tools/scenario_create_conflict.md) read, [scenario_inspect.run](../tools/scenario_inspect.md) read, [world_compose_summary.run](../tools/world_compose_summary.md) read, [world_diff.run](../tools/world_diff.md) read, [world_validate_refs.run](../tools/world_validate_refs.md) read |
| file:.smap | T2/T3 | candidate: file-format | none |
| file:.terr | T2/T3 | candidate: file-format | none |
| file:.topo | T2/T3 | candidate: file-format | none |
| file:.ttile | T2/T3 | candidate: file-format | none |
| file:file-type/Editor settings (registry) | T0/T3 | candidate: file-format | none |
| file:file-type/Height map import%2Fexport .asc, 16-bit .png | T0/T3 | candidate: gui-automation, net-api-handler | none |
| file:file-type/Layer file .layer | T0/T3 | candidate: file-format | none |
| file:file-type/Layer set of a world | T0/T3 | candidate: file-format | none |
| file:file-type/Navmesh .nmn, .ntile | T0/T3 | candidate: cli | none |
| file:file-type/Object import CSV | T0/T3 | candidate: gui-automation | none |
| file:file-type/Per-world editor state | T0/T3 | candidate: file-format | none |
| file:file-type/Prefab .et (prefab edit mode) | T0/T3 | candidate: file-format, net-api-handler | none |
| file:file-type/Resource meta .ent.meta | T0/T3 | candidate: file-format, net-api-handler | none |
| file:file-type/Surface%2Fsound%2Ftopo maps .smap, .smd, .topo, *_SMD.conf | T0/T3 | candidate: cli | none |
| file:file-type/Terrain data .terr, .ttile | T0/T3 | candidate: net-api-handler | none |
| file:file-type/Terrain textures .edds under worlds%2F | T0/T3 | candidate: gui-automation | none |
| file:file-type/World file .ent | T0/T3 | candidate: file-format | none |

### handler-action (155)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| mcp:handler-action/EMCP_WB_AnimDebug.btBreakpoint | T3/T5 | candidate: net-api-handler | [wb_anim_debug.btBreakpoint](../tools/wb_anim_debug.md) drive |
| mcp:handler-action/EMCP_WB_AnimDebug.command | T3/T5 | candidate: net-api-handler | [wb_anim_debug.command](../tools/wb_anim_debug.md) drive |
| mcp:handler-action/EMCP_WB_AnimDebug.procAnim | T3/T5 | candidate: net-api-handler | [wb_anim_debug.procAnim](../tools/wb_anim_debug.md) read |
| mcp:handler-action/EMCP_WB_AnimDebug.set | T3/T5 | candidate: net-api-handler | [wb_anim_debug.set](../tools/wb_anim_debug.md) drive |
| mcp:handler-action/EMCP_WB_AnimDebug.tags | T3/T5 | candidate: net-api-handler | [wb_anim_debug.tags](../tools/wb_anim_debug.md) read |
| mcp:handler-action/EMCP_WB_AnimDebug.vars | T3/T5 | candidate: net-api-handler | [wb_anim_debug.vars](../tools/wb_anim_debug.md) read |
| mcp:handler-action/EMCP_WB_Clipboard.copy | T2/T5 | candidate: net-api-handler | [wb_clipboard.copy](../tools/wb_clipboard.md) read |
| mcp:handler-action/EMCP_WB_Clipboard.cut | T2/T5 | candidate: net-api-handler | [wb_clipboard.cut](../tools/wb_clipboard.md) read |
| mcp:handler-action/EMCP_WB_Clipboard.duplicate | T2/T5 | candidate: net-api-handler | [wb_clipboard.duplicate](../tools/wb_clipboard.md) read |
| mcp:handler-action/EMCP_WB_Clipboard.hasCopied | T2/T5 | candidate: net-api-handler | [wb_clipboard.hasCopied](../tools/wb_clipboard.md) read |
| mcp:handler-action/EMCP_WB_Clipboard.paste | T2/T5 | candidate: net-api-handler | [wb_clipboard.paste](../tools/wb_clipboard.md) read |
| mcp:handler-action/EMCP_WB_Clipboard.pasteAtCursor | T2/T5 | candidate: net-api-handler | [wb_clipboard.pasteAtCursor](../tools/wb_clipboard.md) read |
| mcp:handler-action/EMCP_WB_Components.add | T2/T5 | candidate: net-api-handler | [wb_component.add](../tools/wb_component.md) read |
| mcp:handler-action/EMCP_WB_Components.list | T2/T5 | candidate: net-api-handler | [wb_component.list](../tools/wb_component.md) read |
| mcp:handler-action/EMCP_WB_Components.remove | T2/T5 | candidate: net-api-handler | [wb_component.remove](../tools/wb_component.md) read |
| mcp:handler-action/EMCP_WB_CreateEntity.run | T2/T5 | candidate: net-api-handler | [scenario_create.run](../tools/scenario_create.md) read, [wb_entity_create.run](../tools/wb_entity_create.md) read, [wb_entity_duplicate.run](../tools/wb_entity_duplicate.md) read |
| mcp:handler-action/EMCP_WB_DeleteEntity.run | T2/T5 | candidate: net-api-handler | [scenario_create.run](../tools/scenario_create.md) read, [wb_entity_delete.run](../tools/wb_entity_delete.md) read, [wb_entity_duplicate.run](../tools/wb_entity_duplicate.md) read |
| mcp:handler-action/EMCP_WB_EditorControl.openResource | T2/T5 | candidate: net-api-handler | [wb_launch.run](../tools/wb_launch.md) read, [wb_open_resource.run](../tools/wb_open_resource.md) read, [wb_projects.open](../tools/wb_projects.md) read |
| mcp:handler-action/EMCP_WB_EditorControl.play | T2/T5 | candidate: net-api-handler | [wb_play.run](../tools/wb_play.md) read |
| mcp:handler-action/EMCP_WB_EditorControl.redo | T2/T5 | candidate: net-api-handler | [wb_undo_redo.redo](../tools/wb_undo_redo.md) read |
| mcp:handler-action/EMCP_WB_EditorControl.save | T2/T5 | candidate: net-api-handler | [wb_save.run](../tools/wb_save.md) read |
| mcp:handler-action/EMCP_WB_EditorControl.saveAs | T2/T5 | candidate: net-api-handler | [wb_save.run](../tools/wb_save.md) read |
| mcp:handler-action/EMCP_WB_EditorControl.stop | T2/T5 | candidate: net-api-handler | [wb_stop.run](../tools/wb_stop.md) read |
| mcp:handler-action/EMCP_WB_EditorControl.undo | T2/T5 | candidate: net-api-handler | [wb_undo_redo.undo](../tools/wb_undo_redo.md) read |
| mcp:handler-action/EMCP_WB_Entity.children | T5/T5 | net-api-handler | [wb_entity.children](../tools/wb_entity.md) drive, [wb_entity.children](../tools/wb_entity.md) read |
| mcp:handler-action/EMCP_WB_Entity.clone | T5/T5 | net-api-handler | [wb_entity.clone](../tools/wb_entity.md) drive, [wb_entity.clone](../tools/wb_entity.md) read |
| mcp:handler-action/EMCP_WB_Entity.create | T5/T5 | net-api-handler | [wb_entity.create](../tools/wb_entity.md) drive, [wb_entity.create](../tools/wb_entity.md) read |
| mcp:handler-action/EMCP_WB_Entity.delete | T5/T5 | net-api-handler | [wb_entity.delete](../tools/wb_entity.md) drive, [wb_entity.delete](../tools/wb_entity.md) read |
| mcp:handler-action/EMCP_WB_Entity.get | T5/T5 | net-api-handler | [wb_entity.get](../tools/wb_entity.md) drive, [wb_entity.get](../tools/wb_entity.md) read |
| mcp:handler-action/EMCP_WB_Entity.list | T5/T5 | net-api-handler | [wb_entity.list](../tools/wb_entity.md) drive, [wb_entity.list](../tools/wb_entity.md) read |
| mcp:handler-action/EMCP_WB_Entity.parent | T5/T5 | net-api-handler | [wb_entity.parent](../tools/wb_entity.md) drive, [wb_entity.parent](../tools/wb_entity.md) read |
| mcp:handler-action/EMCP_WB_Entity.query | T5/T5 | net-api-handler | [wb_entity.query](../tools/wb_entity.md) drive, [wb_entity.query](../tools/wb_entity.md) read |
| mcp:handler-action/EMCP_WB_Entity.rename | T5/T5 | net-api-handler | [wb_entity.rename](../tools/wb_entity.md) drive, [wb_entity.rename](../tools/wb_entity.md) read |
| mcp:handler-action/EMCP_WB_Entity.setLayer | T5/T5 | net-api-handler | [wb_entity.setLayer](../tools/wb_entity.md) drive, [wb_entity.setLayer](../tools/wb_entity.md) read |
| mcp:handler-action/EMCP_WB_Entity.transform | T5/T5 | net-api-handler | [wb_entity.transform](../tools/wb_entity.md) drive, [wb_entity.transform](../tools/wb_entity.md) read |
| mcp:handler-action/EMCP_WB_Entity.unparent | T5/T5 | net-api-handler | [wb_entity.unparent](../tools/wb_entity.md) drive, [wb_entity.unparent](../tools/wb_entity.md) read |
| mcp:handler-action/EMCP_WB_ExecuteAction.run | T2/T5 | candidate: net-api-handler | [wb_execute_action.run](../tools/wb_execute_action.md) read, [wb_menu.run](../tools/wb_menu.md) drive |
| mcp:handler-action/EMCP_WB_Generator.attach | T3/T5 | candidate: net-api-handler | [wb_generator.attach](../tools/wb_generator.md) drive |
| mcp:handler-action/EMCP_WB_Generator.detach | T3/T5 | candidate: net-api-handler | [wb_generator.detach](../tools/wb_generator.md) drive |
| mcp:handler-action/EMCP_WB_Generator.events | T3/T5 | candidate: net-api-handler | [wb_generator.events](../tools/wb_generator.md) drive |

115 more: wb_census find with module=WorldEditor kind=handler-action.

### hazard-dialog (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:WorldEditor/hazard-dialog/Enfusion engine | T2/T2 | candidate: gui-automation | none |

### link-format (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| link:enfusion://WorldEditor | T1/T5 | candidate: cli | [wb_link.build](../tools/wb_link.md) read, [wb_link.fromView](../tools/wb_link.md) read, [wb_link.open](../tools/wb_link.md) drive, [wb_link.parse](../tools/wb_link.md) read |
| link:https://community.bistudio.com/wiki/Arma_Reforger:World_Editor | T2/T5 | candidate: file-format | none |

### mcp-action (120)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| mcp:action/scenario_create.run | T2/T5 | candidate: none-known | none |
| mcp:action/terrain_navmesh_status.run | T2/T5 | candidate: none-known | none |
| mcp:action/wb_anim_debug.btBreakpoint | T3/T5 | candidate: none-known | [wb_anim_debug.btBreakpoint](../tools/wb_anim_debug.md) drive |
| mcp:action/wb_anim_debug.command | T3/T5 | candidate: none-known | [wb_anim_debug.command](../tools/wb_anim_debug.md) drive |
| mcp:action/wb_anim_debug.procAnim | T3/T5 | candidate: none-known | [wb_anim_debug.procAnim](../tools/wb_anim_debug.md) drive |
| mcp:action/wb_anim_debug.set | T3/T5 | candidate: none-known | [wb_anim_debug.set](../tools/wb_anim_debug.md) drive |
| mcp:action/wb_anim_debug.tags | T3/T5 | candidate: none-known | [wb_anim_debug.tags](../tools/wb_anim_debug.md) drive |
| mcp:action/wb_anim_debug.vars | T3/T5 | candidate: none-known | [wb_anim_debug.vars](../tools/wb_anim_debug.md) drive |
| mcp:action/wb_clipboard.copy | T3/T5 | candidate: none-known | [wb_clipboard.copy](../tools/wb_clipboard.md) drive |
| mcp:action/wb_clipboard.cut | T3/T5 | candidate: none-known | [wb_clipboard.cut](../tools/wb_clipboard.md) drive |
| mcp:action/wb_clipboard.duplicate | T3/T5 | candidate: none-known | [wb_clipboard.duplicate](../tools/wb_clipboard.md) drive |
| mcp:action/wb_clipboard.hasCopied | T3/T5 | candidate: none-known | [wb_clipboard.hasCopied](../tools/wb_clipboard.md) drive |
| mcp:action/wb_clipboard.paste | T3/T5 | candidate: none-known | [wb_clipboard.paste](../tools/wb_clipboard.md) drive |
| mcp:action/wb_clipboard.pasteAtCursor | T3/T5 | candidate: none-known | [wb_clipboard.pasteAtCursor](../tools/wb_clipboard.md) drive |
| mcp:action/wb_component.add | T3/T5 | candidate: none-known | [wb_component.add](../tools/wb_component.md) drive |
| mcp:action/wb_component.list | T3/T5 | candidate: none-known | [wb_component.list](../tools/wb_component.md) drive |
| mcp:action/wb_component.remove | T3/T5 | candidate: none-known | [wb_component.remove](../tools/wb_component.md) drive |
| mcp:action/wb_connect.run | T2/T5 | candidate: none-known | none |
| mcp:action/wb_entity.children | T5/T5 | net-api-handler | [wb_entity.children](../tools/wb_entity.md) drive |
| mcp:action/wb_entity.clone | T5/T5 | net-api-handler | [wb_entity.clone](../tools/wb_entity.md) drive |
| mcp:action/wb_entity.create | T5/T5 | net-api-handler | [wb_entity.create](../tools/wb_entity.md) drive |
| mcp:action/wb_entity.delete | T5/T5 | net-api-handler | [wb_entity.delete](../tools/wb_entity.md) drive |
| mcp:action/wb_entity.get | T5/T5 | net-api-handler | [wb_entity.get](../tools/wb_entity.md) drive |
| mcp:action/wb_entity.list | T5/T5 | net-api-handler | [wb_entity.list](../tools/wb_entity.md) drive |
| mcp:action/wb_entity.parent | T5/T5 | net-api-handler | [wb_entity.parent](../tools/wb_entity.md) drive |
| mcp:action/wb_entity.query | T5/T5 | net-api-handler | [wb_entity.query](../tools/wb_entity.md) drive |
| mcp:action/wb_entity.rename | T5/T5 | net-api-handler | [wb_entity.rename](../tools/wb_entity.md) drive |
| mcp:action/wb_entity.setLayer | T5/T5 | net-api-handler | [wb_entity.setLayer](../tools/wb_entity.md) drive |
| mcp:action/wb_entity.transform | T5/T5 | net-api-handler | [wb_entity.transform](../tools/wb_entity.md) drive |
| mcp:action/wb_entity.unparent | T5/T5 | net-api-handler | [wb_entity.unparent](../tools/wb_entity.md) drive |
| mcp:action/wb_entity_create.run | T2/T5 | candidate: none-known | none |
| mcp:action/wb_entity_delete.run | T2/T5 | candidate: none-known | none |
| mcp:action/wb_entity_duplicate.run | T2/T5 | candidate: none-known | none |
| mcp:action/wb_entity_inspect.run | T2/T5 | candidate: none-known | none |
| mcp:action/wb_entity_list.run | T2/T5 | candidate: none-known | none |
| mcp:action/wb_entity_select.clear | T3/T5 | candidate: none-known | [wb_entity_select.clear](../tools/wb_entity_select.md) drive |
| mcp:action/wb_entity_select.deselect | T3/T5 | candidate: none-known | [wb_entity_select.deselect](../tools/wb_entity_select.md) drive |
| mcp:action/wb_entity_select.getSelected | T3/T5 | candidate: none-known | [wb_entity_select.getSelected](../tools/wb_entity_select.md) drive |
| mcp:action/wb_entity_select.select | T3/T5 | candidate: none-known | [wb_entity_select.select](../tools/wb_entity_select.md) drive |
| mcp:action/wb_generator.attach | T2/T5 | candidate: none-known | none |

80 more: wb_census find with module=WorldEditor kind=mcp-action.

### mcp-tool (30)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| mcp:tool/scenario_create | T2/T5 | candidate: none-known | none |
| mcp:tool/terrain_navmesh_status | T2/T5 | candidate: none-known | none |
| mcp:tool/wb_anim_debug | T2/T2 | candidate: none-known | none |
| mcp:tool/wb_clipboard | T2/T2 | candidate: none-known | none |
| mcp:tool/wb_component | T2/T2 | candidate: none-known | none |
| mcp:tool/wb_connect | T2/T5 | candidate: none-known | none |
| mcp:tool/wb_entity | T2/T2 | candidate: none-known | none |
| mcp:tool/wb_entity_create | T2/T5 | candidate: none-known | none |
| mcp:tool/wb_entity_delete | T2/T5 | candidate: none-known | none |
| mcp:tool/wb_entity_duplicate | T2/T5 | candidate: none-known | none |
| mcp:tool/wb_entity_inspect | T2/T5 | candidate: none-known | none |
| mcp:tool/wb_entity_list | T2/T5 | candidate: none-known | none |
| mcp:tool/wb_entity_select | T2/T2 | candidate: none-known | none |
| mcp:tool/wb_generator | T2/T2 | candidate: none-known | none |
| mcp:tool/wb_launch | T2/T5 | candidate: none-known | none |
| mcp:tool/wb_layers | T2/T2 | candidate: none-known | none |
| mcp:tool/wb_menu | T0/T2 | candidate: none-known | none |
| mcp:tool/wb_module | T2/T2 | candidate: none-known | none |
| mcp:tool/wb_navmesh | T2/T2 | candidate: none-known | none |
| mcp:tool/wb_open_resource | T0/T5 | candidate: none-known | none |
| mcp:tool/wb_particle | T2/T2 | candidate: none-known | none |
| mcp:tool/wb_play | T2/T5 | candidate: none-known | none |
| mcp:tool/wb_save | T0/T5 | candidate: none-known | none |
| mcp:tool/wb_shape | T2/T2 | candidate: none-known | none |
| mcp:tool/wb_state | T2/T5 | candidate: none-known | none |
| mcp:tool/wb_stop | T0/T5 | candidate: none-known | none |
| mcp:tool/wb_terrain | T2/T2 | candidate: none-known | none |
| mcp:tool/wb_undo_redo | T0/T2 | candidate: none-known | none |
| mcp:tool/wb_view | T2/T2 | candidate: none-known | none |
| mcp:tool/wb_world_tools | T2/T2 | candidate: none-known | none |

### menu (36)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:WorldEditor/menu/Copy view link | T0/T3 | candidate: execute-action, net-api-handler | none |
| ui:WorldEditor/menu/Create new world | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:WorldEditor/menu/Edit | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Entities | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Entities/Add Child Prefab | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Entities/Delete | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Entities/Replace with Prefab | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/File | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Force Save All | T0/T2 | candidate: cli, execute-action | none |
| ui:WorldEditor/menu/Game | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Game/Play Game Options | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Game/Play Game Options/World Systems Config | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Help | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Play Game | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Play options | T0/T3 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu/Plugins | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Plugins/BIKI | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Plugins/Building Destruction | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Plugins/Entity checks | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Plugins/Import%2FExport | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Plugins/In-game Editor | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Plugins/Mass Processing | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Plugins/Prefab Structure | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Plugins/Settings | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Plugins/Terrain | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Plugins/Tools | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Plugins/Update | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Plugins/Update/1.0.0 to 1.1.0 | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Plugins/World Setup | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Reload game scripts | T0/T3 | candidate: builtin-net-handler, execute-action | none |
| ui:WorldEditor/menu/Save world as | T0/T3 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/menu/Tools | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/View | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/View/Transformation Gizmo | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Window | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/menu/Window/Layout | T2/T3 | candidate: gui-automation | none |

### menu-item (187)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:WorldEditor/menu-item/Edit/Copy | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Edit/Cut | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Edit/Duplicate | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Edit/Edit Selected Prefab | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Edit/New Camera Keyframe | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Edit/Open Material under Cursor | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Edit/Paste | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Edit/Paste on Same Position | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Edit/Redo | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Edit/Undo | T3/T5 | candidate: execute-action, gui-automation | [wb_menu.run](../tools/wb_menu.md) drive |
| ui:WorldEditor/menu-item/Entities/@QWidgetAction.1 | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Entities/@QWidgetAction.2 | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Entities/@QWidgetAction.3 | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Entities/Add Child Prefab/To Prefab | T5/T5 | net-api-handler | [wb_prefabs.addMembers](../tools/wb_prefabs.md) drive |
| ui:WorldEditor/menu-item/Entities/Add Child Prefab/To World | T5/T5 | net-api-handler | [wb_entity.create](../tools/wb_entity.md) drive |
| ui:WorldEditor/menu-item/Entities/Apply Changes to Prefab | T5/T5 | net-api-handler | [wb_prefabs.save](../tools/wb_prefabs.md) drive |
| ui:WorldEditor/menu-item/Entities/Break Prefab Instance | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Entities/Copy Name | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Entities/Create Prefab Instance | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Entities/Delete/From Prefab Shift+Delete | T3/T5 | candidate: execute-action, gui-automation | [wb_prefabs.removeMembers](../tools/wb_prefabs.md) drive |
| ui:WorldEditor/menu-item/Entities/Delete/From World Delete | T5/T5 | net-api-handler | [wb_entity.delete](../tools/wb_entity.md) drive |
| ui:WorldEditor/menu-item/Entities/Focus Selection | T5/T5 | net-api-handler | [wb_menu.run](../tools/wb_menu.md) drive, [wb_view.focus](../tools/wb_view.md) drive |
| ui:WorldEditor/menu-item/Entities/Hide All Except Selected | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Entities/Hide%2FShow | T5/T5 | net-api-handler | [wb_view.setVisible](../tools/wb_view.md) drive |
| ui:WorldEditor/menu-item/Entities/Jump to Script Definition | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Entities/Locate Nested Prefab | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Entities/Locate Prefab | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Entities/Locate Prefab in Library | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Entities/Open Mesh in Material Editor | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Entities/Open Nested Prefab | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Entities/Open Prefab | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Entities/Place Using Physics | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Entities/Remove from Parent | T5/T5 | net-api-handler | [wb_entity.unparent](../tools/wb_entity.md) drive |
| ui:WorldEditor/menu-item/Entities/Rename | T5/T5 | net-api-handler | [wb_entity.rename](../tools/wb_entity.md) drive |
| ui:WorldEditor/menu-item/Entities/Replace with Prefab/In Prefab | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Entities/Replace with Prefab/In World | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Entities/Select Children | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Entities/Select Layer | T3/T5 | execute-action | [wb_menu.run](../tools/wb_menu.md) drive |
| ui:WorldEditor/menu-item/Entities/Select Parent | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/menu-item/Entities/Select Prefab Instance Members | T2/T5 | candidate: execute-action, gui-automation | none |

147 more: wb_census find with module=WorldEditor kind=menu-item.

### method (760)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:BakeMlodTool.OnActivate/0 | T2/T5 | candidate: net-api-handler | none |
| api:BuildShoreMapWEPlugin.Run/0 | T2/T5 | candidate: net-api-handler | none |
| api:CameraOrientationTool.Configure/0 | T2/T5 | candidate: net-api-handler | none |
| api:CameraOrientationTool.Run/0 | T2/T5 | candidate: net-api-handler | none |
| api:DedicatedServerPluginCLI.GetCLI/2 | T2/T5 | candidate: net-api-handler | none |
| api:DedicatedServerPluginCLI_Config.GetCLI/2 | T2/T5 | candidate: net-api-handler | none |
| api:DedicatedServerPluginCLI_Server.GetCLI/2 | T2/T5 | candidate: net-api-handler | none |
| api:EditorPlugin.ButtonClose/0 | T2/T5 | candidate: net-api-handler | none |
| api:EditorPlugin.Configure/0 | T2/T5 | candidate: net-api-handler | none |
| api:EditorPlugin.OnGameModeStarted/5 | T2/T5 | candidate: net-api-handler | none |
| api:EditorPlugin.RunCommandline/0 | T2/T2 | candidate: net-api-handler | none |
| api:EditorPlugin.Unpause/0 | T2/T5 | candidate: net-api-handler | none |
| api:EntityOrientationTool.Configure/0 | T2/T5 | candidate: net-api-handler | none |
| api:EntityOrientationTool.Run/0 | T2/T5 | candidate: net-api-handler | none |
| api:EntityRelativePlugin.Configure/0 | T2/T5 | candidate: net-api-handler | none |
| api:EntityRelativePlugin.Run/0 | T2/T5 | candidate: net-api-handler | none |
| api:GameModeSetupConfig.GameModeSetupConfig/0 | T2/T5 | candidate: net-api-handler | none |
| api:GameModeSetupConfig.GenerateMissionHeader/2 | T2/T5 | candidate: net-api-handler | none |
| api:GameModeSetupConfig.GenerateWorld/1 | T2/T5 | candidate: net-api-handler | none |
| api:GameModeSetupConfig.GetWorldEntityTypes/0 | T2/T5 | candidate: net-api-handler | none |
| api:GameModeSetupConfig.Init/0 | T2/T5 | candidate: net-api-handler | none |
| api:GameModeSetupConfig.ValidateMissionHeader/1 | T2/T5 | candidate: net-api-handler | none |
| api:GameModeSetupConfig.ValidateWorld/2 | T2/T5 | candidate: net-api-handler | none |
| api:GameModeSetupConfigEntry.CreateEntity/5 | T2/T5 | candidate: net-api-handler | none |
| api:GenerateFlowMapsWEPlugin.Run/0 | T2/T5 | candidate: net-api-handler | none |
| api:MeasureTool.Deinit/0 | T2/T5 | candidate: net-api-handler | none |
| api:MeasureTool.Init/0 | T2/T5 | candidate: net-api-handler | none |
| api:MeasureTool.OnActivate/0 | T2/T5 | candidate: net-api-handler | none |
| api:MeasureTool.OnAfterLoadWorld/0 | T2/T5 | candidate: net-api-handler | none |
| api:MeasureTool.OnBeforeUnloadWorld/0 | T2/T5 | candidate: net-api-handler | none |
| api:MeasureTool.OnDeActivate/0 | T2/T5 | candidate: net-api-handler | none |
| api:MeasureTool.OnKeyPressEvent/2 | T2/T5 | candidate: net-api-handler | none |
| api:MeasureTool.OnMouseMoveEvent/2 | T2/T5 | candidate: net-api-handler | none |
| api:MeasureTool.OnMousePressEvent/3 | T2/T5 | candidate: net-api-handler | none |
| api:PeerPlugin.Configure/0 | T2/T5 | candidate: net-api-handler | none |
| api:PeerPlugin.DelayedStart/1 | T2/T5 | candidate: net-api-handler | none |
| api:PeerPlugin.End/0 | T2/T5 | candidate: net-api-handler | none |
| api:PeerPlugin.GetAddonsCLI/0 | T2/T5 | candidate: net-api-handler | none |
| api:PeerPlugin.GetAddonsDirCLI/0 | T2/T5 | candidate: net-api-handler | none |
| api:PeerPlugin.OkButton/0 | T2/T5 | candidate: net-api-handler | none |

720 more: wb_census find with module=WorldEditor kind=method.

### module (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:WorldEditor/module/WorldEditor | T1/T5 | candidate: builtin-net-handler, net-api-handler | none |

### net-field (21)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| net:handler/ExportSurfaceMasks#req:exportDirectory | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportSurfaceMasks#req:terrainIndex | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportSurfaceMasks#resp:success | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTerrain#req:area | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTerrain#req:count | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTerrain#req:path | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTerrain#req:worldPath | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTerrain#resp:Output | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/GetSelectedEntities#resp:entities | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/GetSurfaceMaterials#req:terrainIndex | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/GetSurfaceMaterials#resp:materials | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/GetTerrainInfo#req:terrainIndex | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/GetTerrainInfo#resp:resolutionX | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/GetTerrainInfo#resp:resolutionY | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/GetTerrainInfo#resp:tilesX | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/GetTerrainInfo#resp:tilesY | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/GetTerrainInfo#resp:unitScale | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/GetTileHeightmap#req:terrainIndex | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/GetTileHeightmap#req:tileX | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/GetTileHeightmap#req:tileY | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/GetTileHeightmap#resp:heightMap | T2/T2 | candidate: builtin-net-handler | none |

### net-handler (6)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| net:handler/ExportSurfaceMasks | T3/T5 | candidate: builtin-net-handler | [wb_terrain_edit.exportMasks](../tools/wb_terrain_edit.md) drive |
| net:handler/ExportTerrain | T2/T5 | candidate: builtin-net-handler | [wb_bi.describe](../tools/wb_bi.md) read, [wb_bi.list](../tools/wb_bi.md) read |
| net:handler/GetSelectedEntities | T2/T5 | candidate: builtin-net-handler | none |
| net:handler/GetSurfaceMaterials | T3/T5 | candidate: builtin-net-handler | [wb_bi.call](../tools/wb_bi.md) drive |
| net:handler/GetTerrainInfo | T3/T5 | candidate: builtin-net-handler | [wb_bi.call](../tools/wb_bi.md) drive |
| net:handler/GetTileHeightmap | T3/T5 | candidate: builtin-net-handler | [wb_bi.call](../tools/wb_bi.md) drive |

### option (110)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| setting:World Editor/EntitySelectFilter | T0/T5 | candidate: file-format, gui-automation | none |
| setting:World Editor/GizmoTransformPoint | T0/T5 | candidate: file-format, gui-automation | none |
| setting:World Editor/PermanentVisualizers | T0/T5 | candidate: file-format, gui-automation | none |
| setting:World Editor/PlayFromCameraPos | T0/T5 | candidate: file-format, gui-automation | none |
| setting:World Editor/PlayInFullscreen | T0/T5 | candidate: file-format, gui-automation | none |
| setting:World Editor/PlayWithoutDisabledLayers | T0/T5 | candidate: file-format, gui-automation | none |
| setting:World Editor/SaveChangesBeforePlayMode | T0/T5 | candidate: file-format, gui-automation | none |
| setting:World Editor/ScriptDebugMode | T0/T5 | candidate: file-format, gui-automation | none |
| setting:World Editor/SelectParentEntities | T0/T5 | candidate: file-format, gui-automation | none |
| setting:World Editor/ShowWorldBounds | T0/T5 | candidate: file-format, gui-automation | none |
| setting:World Editor/TranslationGizmoMode | T0/T5 | candidate: file-format, gui-automation | none |
| setting:World Editor/UseGameCameraPosAtReturn | T0/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Coords Tool/Use Web Prefix | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Ground Manipulation Tool/Place using physics | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Ground Manipulation Tool/Snap horizontally | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Ground Manipulation Tool/Snap rotation | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Ground Manipulation Tool/Snap to ground | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Ground Manipulation Tool/Snap vertically | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Ground Manipulation Tool/Transform specs/Keep elevation of all | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Ground Manipulation Tool/Transform specs/Negative elevation | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Ground Manipulation Tool/Transform specs/Rotate separately | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Ground Manipulation Tool/Transform specs/Snap separately | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Ground Manipulation Tool/Transform specs/Transform children | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Object Brush Tool/Object Brush/Density Fall Off Curve | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Object Brush Tool/Object Brush/Density Fall Off Enabled | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Object Brush Tool/Object Brush/Density Fall Off Subarea Count | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Object Brush Tool/Object Brush/Objects Config | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Object Brush Tool/Object Brush/Override Brush | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Object Brush Tool/Object Brush/Radius | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Object Brush Tool/Object Brush/Scale Fall Off Curve | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Object Brush Tool/Object Brush/Strength | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Object Brush Tool/Objects Config/Align To Normal | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Object Brush Tool/Objects Config/Bot Distance | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Object Brush Tool/Objects Config/Lowest Scale Falloff Value | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Object Brush Tool/Objects Config/Max Random Vertical Offset | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Object Brush Tool/Objects Config/Max Scale | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Object Brush Tool/Objects Config/Min Random Vertical Offset | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Object Brush Tool/Objects Config/Min Scale | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Object Brush Tool/Objects Config/Override Randomization | T1/T5 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/option/Object Brush Tool/Objects Config/Prefab | T1/T5 | candidate: file-format, gui-automation | none |

70 more: wb_census find with module=WorldEditor kind=option.

### panel (37)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:WorldEditor/panel/#createDockContents | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/#currentToolDockContents | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/#entityPropDockContents | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/#hierarchyDockContents | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/#logDockContents | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/#moveByOffsetGroup | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/#pointToPointSnapping | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/#resourceBrowserDockContents | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/#statusBar | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/#templateLibraryDockContents | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/@QMainWindowTabBar.1 | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/@QMainWindowTabBar.2 | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/@QMainWindowTabBar.3 | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/Cinematic widget | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/Create | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/Create panel | T0/T3 | candidate: net-api-handler | none |
| ui:WorldEditor/panel/Drag-and-drop into viewport | T0/T3 | candidate: net-api-handler | none |
| ui:WorldEditor/panel/Edit scope selector | T0/T3 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/panel/Hierarchy | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/Hierarchy panel | T0/T3 | candidate: gui-automation, net-api-handler | none |
| ui:WorldEditor/panel/Layers and folders (Hierarchy) | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:WorldEditor/panel/Log Console | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/Log Console panel | T0/T3 | candidate: file-format | none |
| ui:WorldEditor/panel/Object Properties | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/Object Properties panel | T0/T3 | candidate: gui-automation, net-api-handler | none |
| ui:WorldEditor/panel/Prefab Library | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/Prefab Library panel | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:WorldEditor/panel/Resource Browser | T2/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/Resource Browser panel | T0/T3 | candidate: gui-automation, net-api-handler | none |
| ui:WorldEditor/panel/Tool Properties | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/Tool Properties panel | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/Viewport | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/panel/Viewport layout presets | T0/T3 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/panel/Viewport navigation | T0/T3 | candidate: net-api-handler | none |
| ui:WorldEditor/panel/Viewport render settings | T0/T3 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/panel/Weather Editor | T0/T3 | candidate: gui-automation, net-api-handler | none |
| ui:WorldEditor/panel/currentToolDock/currentToolDockContents/@EntityMoveToolPanel.1 | T0/T3 | candidate: gui-automation | none |

### plugin (109)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:Autotest | T0/T5 | candidate: execute-action, plugin-run | none |
| plugin:BuildShoreMapWEPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:CameraOrientationTool | T2/T5 | candidate: plugin-run | [wb_plugin.run](../tools/wb_plugin.md) drive |
| plugin:EditorPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:EntityOrientationTool | T2/T5 | candidate: plugin-run | none |
| plugin:EntityRelativePlugin | T2/T5 | candidate: plugin-run | none |
| plugin:GenerateFlowMapsWEPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:PeerPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_AddPrefabToSelectedEntitiesPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_CreateEditablePrefabsPlugin | T2/T2 | candidate: plugin-run | none |
| plugin:SCR_DamageAreaShapesPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DedicatedServerPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_EntityFlagsManagerPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_EntitySpawnerPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ExportGeoDataPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_FPSDiagnosticPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_FloatersFinderPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_GameModeSetupPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_MarkShapesEditorOnlyPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ObjectImportPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_PrefabEditingPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_PrefabStructureCreationPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_PrefabStructureFillingPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ProjectileWindageDataGeneratorPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_RuinPrefabAssignerPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_RuinPrefabCreatorPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ScenarioFrameworkConversionPlugin_Phase1 | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ScenarioFrameworkConversionPlugin_Phase2 | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_SnapAndOrientToTerrainPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_SocketSpawnerPluginWE | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_TerrainEdgesFinderPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_TerrainEntityVariantReplacementPlugin | T2/T2 | candidate: plugin-run | none |
| plugin:SCR_TerrainSlopeViewerPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_VerifyItemsPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_VerifySlotEntitiesPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_WorldEntitiesStatisticsPlugin | T2/T2 | candidate: plugin-run | none |
| plugin:SCR_WorldSetupPlugin_Entities | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_WorldSetupPlugin_GenericWorldEntity | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_WorldWindowDataDropPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_WrapEntitiesPlugin | T2/T5 | candidate: plugin-run | none |

69 more: wb_census find with module=WorldEditor kind=plugin.

### plugin-button (50)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:EditorPlugin#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:PeerPlugin#button:OkButton | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_CreateEditablePrefabsPlugin#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DedicatedServerPlugin#button:ButtonClients | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DedicatedServerPlugin#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DedicatedServerPlugin#button:ButtonRun | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_EntityFlagsManagerPlugin#button:BtnCancel | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_EntityFlagsManagerPlugin#button:BtnOK | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_EntityReplacerTool#button:ReplaceFromAllEntities | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_EntityReplacerTool#button:ReplaceFromSelectedEntities | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_EntitySpawnerPlugin#button:ButtonCancel | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_EntitySpawnerPlugin#button:ButtonOK | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ExportGeoDataPlugin#button:ButtonCancel | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ExportGeoDataPlugin#button:ButtonExport | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_FPSDiagnosticPlugin#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_FPSDiagnosticPlugin#button:ButtonDiagnose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_FloatersFinderPlugin#button:ButtonOK | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_GameModeSetupPlugin#button:ButtonCancel | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_GameModeSetupPlugin#button:ButtonNext | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ImportShapefilePlugin#button:ButtonCancel | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ImportShapefilePlugin#button:ButtonProcess | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_MarkShapesEditorOnlyPlugin#button:ButtonCancel | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_MarkShapesEditorOnlyPlugin#button:ButtonOK | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_NormalAlignedFloatersFinderPlugin#button:ButtonCancel | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_NormalAlignedFloatersFinderPlugin#button:ButtonOK | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ObjectBrushTool#button:DeleteEntities | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ObjectImportPlugin#button:ButtonCancel | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ObjectImportPlugin#button:ButtonImport | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_PrefabEditingPlugin#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_PrefabStructureCreationPlugin#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_PrefabStructureCreationPlugin#button:ButtonOK | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ProjectileWindageDataGeneratorPlugin#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ProjectileWindageDataGeneratorPlugin#button:ButtonRun | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_SocketSpawnerPluginWE#button:Close | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_SocketSpawnerPluginWE#button:Execute | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_TerrainEdgesFinderPlugin#button:ButtonCancel | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_TerrainEdgesFinderPlugin#button:ButtonProcess | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_TerrainEntityVariantReplacementPlugin#button:ButtonCancel | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_TerrainEntityVariantReplacementPlugin#button:ButtonOK | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_TerrainSlopeViewerPlugin#button:ButtonCancel | T2/T5 | candidate: plugin-run | none |

10 more: wb_census find with module=WorldEditor kind=plugin-button.

### plugin-cli-arg (4)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:SCR_DedicatedServerPlugin#cli:-addonsdir | T2/T5 | candidate: cli | none |
| plugin:SCR_TerrainEntityVariantReplacementPlugin#cli:-tevrconfig | T2/T5 | candidate: cli | none |
| plugin:SCR_TerrainEntityVariantReplacementPlugin#cli:-tevrvariant | T2/T5 | candidate: cli | none |
| plugin:SCR_TerrainEntityVariantReplacementPlugin#cli:-tevrworld | T2/T5 | candidate: cli | none |

### plugin-setting (205)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:EditorPlugin#attr:m_bStartOnWorldEditorCamera | T2/T4 | candidate: plugin-run | none |
| plugin:EditorPlugin#attr:m_bStartUnpaused | T2/T4 | candidate: plugin-run | none |
| plugin:PeerPlugin#attr:Executable | T2/T4 | candidate: plugin-run | none |
| plugin:PeerPlugin#attr:PeersWindows | T2/T4 | candidate: plugin-run | none |
| plugin:PeerPlugin#attr:launchDelay | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_CreateEditablePrefabsPlugin#attr:m_bOnlyUpdate | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_CreateEditablePrefabsPlugin#attr:m_sConfig | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_DedicatedServerPlugin#attr:m_Config | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_DedicatedServerPlugin#attr:m_aPeersConfig | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_DedicatedServerPlugin#attr:m_bNoThrow | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_DedicatedServerPlugin#attr:m_bRunPeers | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_DedicatedServerPlugin#attr:m_iBackendEnv | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_DedicatedServerPlugin#attr:m_iLogBackend | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_DedicatedServerPlugin#attr:m_iLogLevel | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_DedicatedServerPlugin#attr:m_iMaxFPS | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_DedicatedServerPlugin#attr:m_sExecutable | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_DedicatedServerPlugin#attr:m_sParams | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_DedicatedServerPlugin#attr:m_sPeerExecutable | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_DedicatedServerPlugin#attr:m_sProfile | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_EntityFlagsManagerPlugin#attr:m_bForceCleaning | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_EntityFlagsManagerPlugin#attr:m_bProcessBuildings | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_EntityFlagsManagerPlugin#attr:m_bProcessBushes | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_EntityFlagsManagerPlugin#attr:m_bProcessEverythingSelected | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_EntityFlagsManagerPlugin#attr:m_bProcessRocks | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_EntityFlagsManagerPlugin#attr:m_bProcessTrees | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_EntityFlagsManagerPlugin#attr:m_bResetDisabledFlag | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_EntityFlagsManagerPlugin#attr:m_bResetEditorOnlyFlag | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_EntityFlagsManagerPlugin#attr:m_bResetFeatureFlag | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_EntityFlagsManagerPlugin#attr:m_bResetNoLinkFlag | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_EntityFlagsManagerPlugin#attr:m_bResetOnFilteredNavmeshFlag | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_EntityFlagsManagerPlugin#attr:m_bResetProxyFlag | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_EntityFlagsManagerPlugin#attr:m_bResetRelativeYFlag | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_EntityFlagsManagerPlugin#attr:m_bResetStaticFlag | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_EntityFlagsManagerPlugin#attr:m_bResetTraceableFlag | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_EntityFlagsManagerPlugin#attr:m_bResetVisibleFlag | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_EntityFlagsManagerPlugin#attr:m_bUpdateChildEntities | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_EntityReplacerTool#attr:m_aReplaceWith | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_EntityReplacerTool#attr:m_aToReplace | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_EntityReplacerTool#attr:m_bActiveLayerOnly | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_EntityReplacerTool#attr:m_bReplaceInOrder | T2/T4 | candidate: plugin-run | none |

165 more: wb_census find with module=WorldEditor kind=plugin-setting.

### property (5)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:WorldEditor/property/Object Properties/entityPropGrid/Angles | T2/T2 | candidate: net-api-handler | none |
| ui:WorldEditor/property/Object Properties/entityPropGrid/Coords | T2/T2 | candidate: net-api-handler | none |
| ui:WorldEditor/property/Object Properties/entityPropGrid/Editor | T2/T2 | candidate: net-api-handler | none |
| ui:WorldEditor/property/Object Properties/entityPropGrid/Scale | T2/T2 | candidate: net-api-handler | none |
| ui:WorldEditor/property/Object Properties/entityPropGrid/Script | T2/T2 | candidate: net-api-handler | none |

### property-group (25)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:WorldEditor/property-group/#entityPropGrid | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/property-group/Change ancestor | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:WorldEditor/property-group/Clear a property | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:WorldEditor/property-group/Entity flags | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:WorldEditor/property-group/Entity identity | T0/T3 | candidate: net-api-handler | none |
| ui:WorldEditor/property-group/In-memory container edits | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/property-group/List properties of an entity%2Fcomponent | T0/T3 | candidate: net-api-handler | none |
| ui:WorldEditor/property-group/Native-type array property | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:WorldEditor/property-group/Nested object property | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:WorldEditor/property-group/Object Properties/entityPropGrid/Flags | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/property-group/Object Properties/entityPropGrid/General | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/property-group/Object Properties/entityPropGrid/Transformation | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/property-group/Object-array property | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:WorldEditor/property-group/Override detection | T0/T3 | candidate: net-api-handler | none |
| ui:WorldEditor/property-group/Prefab Library/@PropertyGridBC.1 | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/property-group/Prefab ancestor of an instance | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:WorldEditor/property-group/Property UI metadata | T0/T3 | candidate: net-api-handler | none |
| ui:WorldEditor/property-group/Read a property value | T0/T3 | candidate: net-api-handler | none |
| ui:WorldEditor/property-group/Read default (prefab) value | T0/T3 | candidate: net-api-handler | none |
| ui:WorldEditor/property-group/Script event slots | T0/T3 | candidate: file-format, gui-automation | none |
| ui:WorldEditor/property-group/Source addons of a resource | T0/T3 | candidate: net-api-handler | none |
| ui:WorldEditor/property-group/Transformation group | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:WorldEditor/property-group/Write a component property | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:WorldEditor/property-group/Write a top-level property | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:WorldEditor/property-group/templateLibraryDock/templateLibraryDockContents/@PropertyGridBC.1 | T0/T3 | candidate: gui-automation | none |

### region (48)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:WorldEditor/region/#DropElementLabel_2 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/#PointSnappingText | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/#SystemMenuBar | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/#centralWidget | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/#contentWindow | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/#currentToolPanel | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/#entityCountLabel | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/#qt_scrollarea_hcontainer | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/#qt_scrollarea_vcontainer | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/#selectedObjectClassName | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/#treePanel | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/@QMenuBar.1 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/@TerrainMinimapViewport.1 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/@TitleBar.1 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/@WorldRenderWindowQt.1 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/entityPropDock/entityPropDockContents/@QSplitterHandle.1 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/entityPropDock/entityPropDockContents/@QSplitterHandle.2 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/entityTreeDock/hierarchyDockContents/entityTree/@Header.1 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/entityTreeDock/hierarchyDockContents/entityTree/@Header.2 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/entityTreeDock/hierarchyDockContents/entityTree/@Header.3 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/entityTreeDock/hierarchyDockContents/entityTree/@Header.4 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/logConsoleDock/logDockContents/@QScrollBar.1 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/logConsoleDock/logDockContents/@QScrollBar.2 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/logConsoleDock/logDockContents/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/minimapDock/@QLabel.1 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/minimapDock/@TerrainMinimapViewport.1 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/resourcesDock/resourceBrowserDockContents/@BreadcrumbTrailWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/resourcesDock/resourceBrowserDockContents/@QLabel.1 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/resourcesDock/resourceBrowserDockContents/@QSplitterHandle.1 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/statusBar/@QLabel.1 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/statusBar/@QLabel.2 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/statusBar/@QLabel.3 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/statusBar/@QLabel.4 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/statusBar/@QLabel.5 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/statusBar/@QSizeGrip.1 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/templateLibraryDock/templateLibraryDockContents/@BreadcrumbTrailWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/templateLibraryDock/templateLibraryDockContents/@QLabel.1 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/templateLibraryDock/templateLibraryDockContents/@QSplitterHandle.1 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/templateLibraryDock/templateLibraryDockContents/@QSplitterHandle.2 | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/region/templateLibraryDock/templateLibraryDockContents/@QWidget.1 | T0/T2 | candidate: gui-automation | none |

8 more: wb_census find with module=WorldEditor kind=region.

### schema-class (1540)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:$grp | T1/T2 | candidate: file-format | none |
| schema:AABBBoundingVolume | T1/T2 | candidate: file-format | none |
| schema:AIActivateEffect | T1/T2 | candidate: file-format | none |
| schema:AIAnimalData | T1/T2 | candidate: file-format | none |
| schema:AIBehaviorTreeComponent | T1/T2 | candidate: file-format | none |
| schema:AIBirdManagerComponent | T1/T2 | candidate: file-format | none |
| schema:AICarMovementComponent | T1/T2 | candidate: file-format | none |
| schema:AICharacterAimingComponent | T1/T2 | candidate: file-format | none |
| schema:AICharacterHeadAimingComponent | T1/T2 | candidate: file-format | none |
| schema:AICharacterMovementComponent | T1/T2 | candidate: file-format | none |
| schema:AIChimeraBehaviorTreeComponent | T1/T2 | candidate: file-format | none |
| schema:AICombatPropertiesComponent | T1/T2 | candidate: file-format | none |
| schema:AIControlComponent | T1/T2 | candidate: file-format | none |
| schema:AIExplosionEffect | T1/T2 | candidate: file-format | none |
| schema:AIFlockMovementComponent | T1/T2 | candidate: file-format | none |
| schema:AIFormationComponent | T1/T2 | candidate: file-format | none |
| schema:AIFormationDefinition | T1/T2 | candidate: file-format | none |
| schema:AIHitEffect | T1/T2 | candidate: file-format | none |
| schema:AIKnowledgeComponent | T1/T2 | candidate: file-format | none |
| schema:AIPathfindingComponent | T1/T2 | candidate: file-format | none |
| schema:AISmartActionUserComponent | T1/T2 | candidate: file-format | none |
| schema:AITurretAimingComponent | T1/T2 | candidate: file-format | none |
| schema:AIWaypointCycle | T1/T2 | candidate: file-format | none |
| schema:ActionsManagerComponent | T2/T2 | candidate: file-format | none |
| schema:ActionsPerformerComponent | T1/T2 | candidate: file-format | none |
| schema:Aerodynamics | T2/T2 | candidate: file-format | none |
| schema:AimingModifierAttributes | T1/T2 | candidate: file-format | none |
| schema:AnimVehicleLightPortal | T1/T2 | candidate: file-format | none |
| schema:AnimationCommand | T1/T2 | candidate: file-format | none |
| schema:AnimationIKTargetInfo | T1/T2 | candidate: file-format | none |
| schema:AnimationPlayerComponent | T1/T2 | candidate: file-format | none |
| schema:AnimationVariable | T1/T2 | candidate: file-format | none |
| schema:AnimationVariableInt | T1/T2 | candidate: file-format | none |
| schema:AnimationVariableMultiSignal | T1/T2 | candidate: file-format | none |
| schema:AttachmentAttributes | T1/T2 | candidate: file-format | none |
| schema:AttachmentBayonet | T1/T2 | candidate: file-format | none |
| schema:AttachmentBayonet6Kh4 | T1/T2 | candidate: file-format | none |
| schema:AttachmentBayonetM9 | T1/T2 | candidate: file-format | none |
| schema:AttachmentBayonetVz58 | T1/T2 | candidate: file-format | none |
| schema:AttachmentCamouflage | T1/T2 | candidate: file-format | none |

1500 more: wb_census find with module=WorldEditor kind=schema-class.

### schema-key (429)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:ActionsManagerComponent.ActionContexts | T2/T2 | candidate: file-format | none |
| schema:ActionsManagerComponent.additionalActions | T2/T2 | candidate: file-format | none |
| schema:Aerodynamics.ReferenceArea | T2/T2 | candidate: file-format | none |
| schema:Axle.HasHandbrake | T2/T2 | candidate: file-format | none |
| schema:Axle.Suspension | T2/T2 | candidate: file-format | none |
| schema:Axle.Wheel | T2/T2 | candidate: file-format | none |
| schema:Axle.WheelPositions | T2/T2 | candidate: file-format | none |
| schema:BaseLightManagerComponent.EmissiveSurfaceSlots | T2/T2 | candidate: file-format | none |
| schema:BaseLightManagerComponent.LightSlots | T2/T2 | candidate: file-format | none |
| schema:BaseLightManagerComponent.LightsEnabled | T2/T2 | candidate: file-format | none |
| schema:BaseSlotComponent.AttachType | T2/T2 | candidate: file-format | none |
| schema:CaseEjectingEffectComponent.HasSound | T2/T2 | candidate: file-format | none |
| schema:Clutch.Output | T2/T2 | candidate: file-format | none |
| schema:CollisionTriggerComponent.DELETE_ON_TRIGGER | T2/T2 | candidate: file-format | none |
| schema:CollisionTriggerComponent.PROJECTILE_EFFECTS | T2/T2 | candidate: file-format | none |
| schema:ExplosionEffect.EffectPrefab | T2/T2 | candidate: file-format | none |
| schema:ExplosionEffect.ParticleEffect | T2/T2 | candidate: file-format | none |
| schema:ExplosionEffect.TriggerOnce | T2/T2 | candidate: file-format | none |
| schema:Helicopter.Engine | T2/T2 | candidate: file-format | none |
| schema:Helicopter.Hull | T2/T2 | candidate: file-format | none |
| schema:Helicopter.Rotors | T2/T2 | candidate: file-format | none |
| schema:HelicopterEngine.RPMIdle | T2/T2 | candidate: file-format | none |
| schema:HelicopterEngine.RPMMax | T2/T2 | candidate: file-format | none |
| schema:HelicopterEngine.ShutdownTime | T2/T2 | candidate: file-format | none |
| schema:HelicopterEngine.StartUpTime | T2/T2 | candidate: file-format | none |
| schema:HelicopterRotorMain.AltNoForce | T2/T2 | candidate: file-format | none |
| schema:HelicopterRotorMain.CollectiveSpeedCoef | T2/T2 | candidate: file-format | none |
| schema:HelicopterRotorMain.CyclicAsideSpeedCoef | T2/T2 | candidate: file-format | none |
| schema:HelicopterRotorMain.CyclicForwardSpeedCoef | T2/T2 | candidate: file-format | none |
| schema:HelicopterRotorMain.Force | T2/T2 | candidate: file-format | none |
| schema:HelicopterRotorMain.RotorDiameter | T2/T2 | candidate: file-format | none |
| schema:HelicopterRotorMain.TorqueForce | T2/T2 | candidate: file-format | none |
| schema:HitZone.DamageReduction | T2/T2 | candidate: file-format | none |
| schema:HitZone.DamageThreshold | T2/T2 | candidate: file-format | none |
| schema:HitZone.Fragmentation%20multiplier | T2/T2 | candidate: file-format | none |
| schema:HitZone.Kinetic%20multiplier | T2/T2 | candidate: file-format | none |
| schema:HitZone.MaxHealth | T2/T2 | candidate: file-format | none |
| schema:JoystickForceEffect.Duration | T2/T2 | candidate: file-format | none |
| schema:JoystickForceEffect.EffectLayerIndex | T2/T2 | candidate: file-format | none |
| schema:JoystickForceEffect.Name | T2/T2 | candidate: file-format | none |

389 more: wb_census find with module=WorldEditor kind=schema-key.

### setting-key (311)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| setting:World Editor%2FCinematicWidget/ShowProperties | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FCinematicWidget/ShowPropertiesPanel | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FCinematicWidget/SnapEnabled | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FCinematicWidget/SplitterState | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FCinematicWidget/TrackPanelWidth | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FComponentList/extraInfo | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FBack/AdaptiveSpeed | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FBack/FOV | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FBack/FarPlane | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FBack/InertiaScale | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FBack/KeepRelativeOffset | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FBack/NearPlane | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FBack/RelativeOffset | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FBack/TerrainCollision | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FBottom/AdaptiveSpeed | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FBottom/FOV | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FBottom/FarPlane | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FBottom/InertiaScale | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FBottom/KeepRelativeOffset | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FBottom/NearPlane | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FBottom/RelativeOffset | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FBottom/TerrainCollision | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FFront/AdaptiveSpeed | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FFront/FOV | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FFront/FarPlane | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FFront/InertiaScale | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FFront/KeepRelativeOffset | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FFront/NearPlane | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FFront/RelativeOffset | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FFront/TerrainCollision | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FLeft/AdaptiveSpeed | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FLeft/FOV | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FLeft/FarPlane | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FLeft/InertiaScale | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FLeft/KeepRelativeOffset | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FLeft/NearPlane | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FLeft/RelativeOffset | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FLeft/TerrainCollision | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FPersp/AdaptiveSpeed | T0/T3 | candidate: file-format | none |
| setting:World Editor%2FContentWindow%2FSubWindows%2FPersp/FOV | T0/T3 | candidate: file-format | none |

271 more: wb_census find with module=WorldEditor kind=setting-key.

### shortcut (128)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:WorldEditor/shortcut/Game/Copy view link | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/Terrain Creation Tool/Info & Diags/visualize surface layers painted on the terrain ground | T0/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/Top Bar/Copy selected object | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/Top Bar/Create new World | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/Top Bar/Cut selected object | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/Top Bar/Ground Manipulation Tool | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/Top Bar/Load World | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/Top Bar/Move Tool | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/Top Bar/Paste on same position | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/Top Bar/Play Game | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/Top Bar/Redo last action | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/Top Bar/Rotate Tool | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/Top Bar/Save World | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/Top Bar/Scale Tool | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/Top Bar/Terrain Creation Tool | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/Top Bar/Toggle Gizmo Space | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/Top Bar/Undo last action | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/Top Bar/Vector Entity Tool | T1/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/Add selected Prefabs to selected entities | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/Autospawner Tool | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/Autotest Tool | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/Bake MLOD Texture | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/Batch prefabs operations tool | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/Build shore map | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/CSV Object Import | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/Change absolute Y to relative | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/Coords Tool | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/Create%2FUpdate Selected Editable Prefabs | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/Dedicated Server Tool | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/Destructible Prefab Finder Tool | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/Destruction indices assign tool | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/Edit Selected Prefab(s) | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/Entities Setup | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/Entity Flags Manager | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/Entity Replacer | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/Export Geographic data | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/Export Map data | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/FPS Diagnostic | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/Floaters Finder | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/shortcut/World Editor Plugins/Game Mode Setup | T2/T2 | candidate: gui-automation | none |

88 more: wb_census find with module=WorldEditor kind=shortcut.

### static-method (102)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:SCR_BuildingDestructionSetupTool.GetDestructionComponentPath/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BuildingDestructionSetupTool.GetTimedEffectPath/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BuildingDestructionSetupTool.ToString/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_EntitySourceHelper.CopyDataFromOldToNewComponent/4 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_EntitySourceHelper.CopyVariablesFromTo/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_EntitySourceHelper.GetShortestVectorString/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_HeatmapHelper.CreateHeatmapImageFromData/7 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_HeatmapHelper.GetFileSuffix/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_HeatmapHelper.GetResolutionFactorEnum/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_ImageHelper.GetImageDataAlphaColour/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_ImageHelper.GetImageDataBlackAndWhite/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_ImageHelper.GetImageDataBlackAndWhiteFromRange/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_ImageHelper.GetTextureRawDataCallbackMethod/4 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_ImageHelper.IncreaseResolution/4 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_ImageHelper.SaveImageDataToPNG/4 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_ImageHelper.SetColorSpaceTo/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_ImageHelper.SetColorSpaceToLinear/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_ImageHelper.SetColorSpaceToSRGB/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_ImageHelper.TEMP_SaveImageDataWrapper/4 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_ParallelShapeTool.CreateParallelOffsetShape/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_ParallelShapeTool.CreateParallelOffsetShapes/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_PrefabFilesHelper.GetClassName/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_PrefabFilesHelper.SetClassName/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_PrefabHelper.BeginEntityAction/0 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_PrefabHelper.ClonePrefab/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_PrefabHelper.CreateChildPrefab/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_PrefabHelper.CreateEntitySource/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_PrefabHelper.CreateEntitySourceComponentIfNeeded/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_PrefabHelper.CreateEntitySourceFromXOB/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_PrefabHelper.CreateEntitySourceWithoutEntity/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_PrefabHelper.CreatePrefabFromXOB/4 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_PrefabHelper.CreatePrefabStructure/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_PrefabHelper.CreatePrefabStructureDirectory/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_PrefabHelper.CreatePrefabsFromXOBs/4 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_PrefabHelper.EndEntityAction/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_PrefabHelper.FormatRelativePath/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_PrefabHelper.GetHierarchyLevel/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_PrefabHelper.GetPrefabs/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_PrefabHelper.GetPrefabsData/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_PrefabHelper.GetPrefabsDataByLevel/1 | T2/T5 | candidate: net-api-handler | none |

62 more: wb_census find with module=WorldEditor kind=static-method.

### status-item (4)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:WorldEditor/status-item/statusBar/0.00 400.00 0.00 [dir: 0.000 0.000 1.000 = north] | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/status-item/statusBar/Material: none | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/status-item/statusBar/Version 1.8.0.13 (production) | T2/T2 | candidate: gui-automation | none |
| ui:WorldEditor/status-item/statusBar/Version 1.9.0.37 (production) | T2/T2 | candidate: gui-automation | none |

### tab (21)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:WorldEditor/tab/@QMainWindowTabBar/Create | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/tab/@QMainWindowTabBar/Hierarchy | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/tab/@QMainWindowTabBar/Log Console | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/tab/@QMainWindowTabBar/Move | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/tab/@QMainWindowTabBar/Object Properties | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/tab/@QMainWindowTabBar/Prefab Library | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/tab/@QMainWindowTabBar/Resource Browser | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/tab/Hierarchy/Create | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/tab/Hierarchy/Hierarchy | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/tab/Object Properties/Move | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/tab/Object Properties/Object Properties | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/tab/Prefab Library/Details Tab | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/tab/Prefab Library/Directory Tab | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/tab/Prefab Library/Entity Tab | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/tab/Resource Browser/Log Console | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/tab/Resource Browser/Prefab Library | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/tab/Resource Browser/Resource Browser | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/tab/Terrain Creation Tool/Info & Diags | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/tab/Terrain Creation Tool/Manage | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/tab/Terrain Creation Tool/Paint | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/tab/Terrain Creation Tool/Sculpt | T1/T3 | candidate: gui-automation | none |

### tool (33)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:BakeMlodTool | T2/T5 | candidate: gui-automation, plugin-run | none |
| plugin:SCR_EntityReplacerTool | T2/T5 | candidate: gui-automation, plugin-run | none |
| plugin:SCR_ImportShapefilePlugin | T2/T5 | candidate: gui-automation, plugin-run | none |
| plugin:SCR_NormalAlignedFloatersFinderPlugin | T2/T5 | candidate: gui-automation, plugin-run | none |
| plugin:SCR_ObjectBrushTool | T2/T5 | candidate: gui-automation, plugin-run | none |
| plugin:SCR_SelectionBrushTool | T2/T5 | candidate: gui-automation, plugin-run | none |
| ui:WorldEditor/tool/Autospawner Tool | T1/T5 | candidate: gui-automation, plugin-run | none |
| ui:WorldEditor/tool/Autotest Tool | T1/T5 | candidate: gui-automation, plugin-run | none |
| ui:WorldEditor/tool/Batch Prefabs operations tool | T1/T5 | candidate: gui-automation, plugin-run | none |
| ui:WorldEditor/tool/Bounding Volume Tool | T1/T5 | candidate: gui-automation, plugin-run | none |
| ui:WorldEditor/tool/Coords Tool | T1/T5 | candidate: gui-automation, plugin-run | none |
| ui:WorldEditor/tool/Ground Manipulation Tool | T1/T5 | candidate: gui-automation, plugin-run | none |
| ui:WorldEditor/tool/Measure Tool | T1/T5 | candidate: gui-automation, plugin-run | none |
| ui:WorldEditor/tool/Move Tool | T1/T5 | candidate: gui-automation, plugin-run | none |
| ui:WorldEditor/tool/Navmesh Tool | T1/T5 | candidate: gui-automation, plugin-run | none |
| ui:WorldEditor/tool/Object Brush Tool | T1/T5 | candidate: gui-automation, plugin-run | none |
| ui:WorldEditor/tool/Parallel Shape Tool | T1/T5 | candidate: gui-automation, plugin-run | none |
| ui:WorldEditor/tool/Polyline Area Tool | T1/T5 | candidate: gui-automation, plugin-run | none |
| ui:WorldEditor/tool/Prefab Management Tool | T1/T5 | candidate: gui-automation, plugin-run | none |
| ui:WorldEditor/tool/Rotate Tool | T1/T5 | candidate: gui-automation, plugin-run | none |
| ui:WorldEditor/tool/Scale Tool | T1/T5 | candidate: gui-automation, plugin-run | none |
| ui:WorldEditor/tool/Shape Area Tool | T1/T5 | candidate: gui-automation, plugin-run | none |
| ui:WorldEditor/tool/Terrain Creation Tool | T1/T5 | candidate: gui-automation, plugin-run | none |
| ui:WorldEditor/tool/Terrain Tool — Holes | T0/T5 | candidate: gui-automation | none |
| ui:WorldEditor/tool/Terrain Tool — Info Diags | T0/T5 | candidate: gui-automation | none |
| ui:WorldEditor/tool/Terrain Tool — Manage: height map | T0/T5 | candidate: builtin-net-handler | none |
| ui:WorldEditor/tool/Terrain Tool — Paint | T0/T5 | candidate: net-api-handler | none |
| ui:WorldEditor/tool/Terrain Tool — Sculpt | T0/T5 | candidate: net-api-handler | none |
| ui:WorldEditor/tool/Terrain Tool — Tile Map | T0/T5 | candidate: gui-automation | none |
| ui:WorldEditor/tool/Vector Entity Tool | T1/T5 | candidate: gui-automation, plugin-run | none |
| ui:WorldEditor/tool/Vector Tool | T1/T5 | candidate: gui-automation, plugin-run | none |
| ui:WorldEditor/tool/Windows Prefabs Generator Tool | T1/T5 | candidate: gui-automation, plugin-run | none |
| ui:WorldEditor/tool/currentToolDock/Move | T1/T5 | candidate: gui-automation, plugin-run | none |

### toolbar (14)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:WorldEditor/toolbar/#toolBar | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/toolbar/#toolbarBasicTools | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/toolbar/#toolbarScriptedTools | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/toolbar/@QToolBar.1 | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/toolbar/@QToolBar.2 | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/toolbar/Entity select filter | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/toolbar/Go to world file | T0/T3 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar/Select parent entities | T0/T3 | candidate: gui-automation | none |
| ui:WorldEditor/toolbar/Toggle gizmo space | T0/T3 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar/Top Bar | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/toolbar/Top Bar/Basic Actions | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/toolbar/Top Bar/Basic Tools | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/toolbar/Top Bar/Scripted Tools | T1/T3 | candidate: gui-automation | none |
| ui:WorldEditor/toolbar/Top bar sections | T0/T3 | candidate: gui-automation | none |

### toolbar-button (58)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:WorldEditor/toolbar-button/#play | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/@QToolBar.1/Camera | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/@QToolBar.1/Placement | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/@QToolBar.1/Selection | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/@QToolBar.1/Shading | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/Top Bar/Copy selected object | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/Top Bar/Create new World | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/Top Bar/Cut selected object | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/Top Bar/Entity select filter | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/Top Bar/Export Geographic data | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/Top Bar/Import Objects | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/Top Bar/Import Shapefile | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/Top Bar/Open Weather Editor | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/Top Bar/Play Game | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/Top Bar/Redo last action | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/Top Bar/Undo last action | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolBar/@QToolButton.1 | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolBar/@QToolButton.2 | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolBar/Copy | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolBar/Cut | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolBar/Go to World File | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolBar/Load World | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolBar/New World | T2/T2 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolBar/Paste on Same Position | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolBar/Redo | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolBar/Save World | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolBar/Select Parent Entities | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolBar/Toggle Gizmo Space | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolBar/Undo | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolbarBasicTools/@QToolButton.1 | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolbarBasicTools/Bounding Volume Tool | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolbarBasicTools/Ground Manipulation Tool | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolbarBasicTools/Move | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolbarBasicTools/Navmesh Tool | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolbarBasicTools/RoadNetwork Tool | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolbarBasicTools/Rotate | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolbarBasicTools/Scale | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolbarBasicTools/Terrain Tool | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolbarBasicTools/Vector Tool | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:WorldEditor/toolbar-button/toolbarScriptedTools/Autospawner Tool | T2/T5 | candidate: execute-action, gui-automation | none |

18 more: wb_census find with module=WorldEditor kind=toolbar-button.

### window (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:WorldEditor/window/#worldEditorMain | T1/T3 | candidate: gui-automation | none |

## Below target (3971)

- T0 to T2: 66
- T0 to T3: 394
- T0 to T5: 269
- T1 to T2: 1453
- T1 to T3: 40
- T1 to T5: 211
- T2 to T3: 55
- T2 to T4: 205
- T2 to T5: 1189
- T3 to T5: 83
- T4 to T5: 6

| id | tier | path |
| --- | --- | --- |
| api:BakeMlodTool.OnActivate/0 | T2/T5 | candidate: net-api-handler |
| api:BuildShoreMapWEPlugin.Run/0 | T2/T5 | candidate: net-api-handler |
| api:CameraOrientationTool.Configure/0 | T2/T5 | candidate: net-api-handler |
| api:CameraOrientationTool.Run/0 | T2/T5 | candidate: net-api-handler |
| api:DedicatedServerPluginCLI.GetCLI/2 | T2/T5 | candidate: net-api-handler |
| api:DedicatedServerPluginCLI_Config.GetCLI/2 | T2/T5 | candidate: net-api-handler |
| api:DedicatedServerPluginCLI_Server.GetCLI/2 | T2/T5 | candidate: net-api-handler |
| api:EditorPlugin.ButtonClose/0 | T2/T5 | candidate: net-api-handler |
| api:EditorPlugin.Configure/0 | T2/T5 | candidate: net-api-handler |
| api:EditorPlugin.OnGameModeStarted/5 | T2/T5 | candidate: net-api-handler |
| api:EditorPlugin.Unpause/0 | T2/T5 | candidate: net-api-handler |
| api:EntityOrientationTool.Configure/0 | T2/T5 | candidate: net-api-handler |
| api:EntityOrientationTool.Run/0 | T2/T5 | candidate: net-api-handler |
| api:EntityRelativePlugin.Configure/0 | T2/T5 | candidate: net-api-handler |
| api:EntityRelativePlugin.Run/0 | T2/T5 | candidate: net-api-handler |
| api:GameModeSetupConfig.GameModeSetupConfig/0 | T2/T5 | candidate: net-api-handler |
| api:GameModeSetupConfig.GenerateMissionHeader/2 | T2/T5 | candidate: net-api-handler |
| api:GameModeSetupConfig.GenerateWorld/1 | T2/T5 | candidate: net-api-handler |
| api:GameModeSetupConfig.GetWorldEntityTypes/0 | T2/T5 | candidate: net-api-handler |
| api:GameModeSetupConfig.Init/0 | T2/T5 | candidate: net-api-handler |
| api:GameModeSetupConfig.ValidateMissionHeader/1 | T2/T5 | candidate: net-api-handler |
| api:GameModeSetupConfig.ValidateWorld/2 | T2/T5 | candidate: net-api-handler |
| api:GameModeSetupConfigEntry.CreateEntity/5 | T2/T5 | candidate: net-api-handler |
| api:GenerateFlowMapsWEPlugin.Run/0 | T2/T5 | candidate: net-api-handler |
| api:MeasureTool.Deinit/0 | T2/T5 | candidate: net-api-handler |
| api:MeasureTool.Init/0 | T2/T5 | candidate: net-api-handler |
| api:MeasureTool.OnActivate/0 | T2/T5 | candidate: net-api-handler |
| api:MeasureTool.OnAfterLoadWorld/0 | T2/T5 | candidate: net-api-handler |
| api:MeasureTool.OnBeforeUnloadWorld/0 | T2/T5 | candidate: net-api-handler |
| api:MeasureTool.OnDeActivate/0 | T2/T5 | candidate: net-api-handler |
| api:MeasureTool.OnKeyPressEvent/2 | T2/T5 | candidate: net-api-handler |
| api:MeasureTool.OnMouseMoveEvent/2 | T2/T5 | candidate: net-api-handler |
| api:MeasureTool.OnMousePressEvent/3 | T2/T5 | candidate: net-api-handler |
| api:PeerPlugin.Configure/0 | T2/T5 | candidate: net-api-handler |
| api:PeerPlugin.DelayedStart/1 | T2/T5 | candidate: net-api-handler |
| api:PeerPlugin.End/0 | T2/T5 | candidate: net-api-handler |
| api:PeerPlugin.GetAddonsCLI/0 | T2/T5 | candidate: net-api-handler |
| api:PeerPlugin.GetAddonsDirCLI/0 | T2/T5 | candidate: net-api-handler |
| api:PeerPlugin.OkButton/0 | T2/T5 | candidate: net-api-handler |
| api:PeerPlugin.OnGameModeEnded/0 | T2/T5 | candidate: net-api-handler |
| api:PeerPlugin.OnGameModeStarted/5 | T2/T5 | candidate: net-api-handler |
| api:PeerPlugin.Start/0 | T2/T5 | candidate: net-api-handler |
| api:PeerPlugin.StartAllWindows/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AddPrefabToSelectedEntitiesPlugin.CreateSelectedPrefabsInSelectedEntities/1 | T2/T5 | candidate: net-api-handler |
| api:SCR_AddPrefabToSelectedEntitiesPlugin.OnResourceContextMenu/1 | T2/T5 | candidate: net-api-handler |
| api:SCR_AddPrefabToSelectedEntitiesPlugin.Run/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutoSpawnerTool.ClearSelection/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutoSpawnerTool.FindFilesByExtension/3 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutoSpawnerTool.FolderScan/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutoSpawnerTool.FormatEntityIndex/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutoSpawnerTool.GenerateComment/2 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutoSpawnerTool.LoadEntities/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutoSpawnerTool.LoadXOBs/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutoSpawnerTool.OnMouseMoveEvent/2 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutoSpawnerTool.OnMousePressEvent/3 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutoSpawnerTool.PlaceSelection/2 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutoSpawnerTool.Preload/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutoSpawnerTool.SpawnFromPrefabList/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutoSpawnerTool.Undo/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_BatchPrefabTitle.SCR_BatchPrefabTitle/4 | T2/T5 | candidate: net-api-handler |

3911 more: wb_census find with module=WorldEditor.

## Dispositions (174)

| id | kind | why | evidence |
| --- | --- | --- | --- |
| api:CameraOrientationTool.Run/0 | blocked | blocked:P-W6-05 until this class passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| api:EditorPlugin.RunCommandline/0 | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| api:EntityOrientationTool.Run/0 | blocked | blocked:P-W6-05 until this class passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| api:SCR_AddPrefabToSelectedEntitiesPlugin.Run/0 | blocked | blocked:P-W6-05 until this class passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| api:SCR_CreateEditablePrefabsPlugin.ButtonClose/0 | subsumed-by | subsumed-by plugin:SCR_CreateEditablePrefabsPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_CreateEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_CreateEditablePrefabsPlugin.Configure/0 | subsumed-by | subsumed-by plugin:SCR_CreateEditablePrefabsPlugin (wb_plugin never calls Configure) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_CreateEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_CreateEditablePrefabsPlugin.Run/0 | subsumed-by | subsumed-by plugin:SCR_CreateEditablePrefabsPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_CreateEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_HeatmapHelper.CreateHeatmapImageFromData/7 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_HeatmapHelper.GetFileSuffix/2 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_HeatmapHelper.GetResolutionFactorEnum/1 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_ImageHelper.GetImageDataAlphaColour/2 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_ImageHelper.GetImageDataBlackAndWhite/1 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_ImageHelper.GetImageDataBlackAndWhiteFromRange/3 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_ImageHelper.GetTextureRawDataCallbackMethod/4 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_ImageHelper.IncreaseResolution/4 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_ImageHelper.SaveImageDataToPNG/4 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_ImageHelper.SetColorSpaceTo/2 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_ImageHelper.SetColorSpaceToLinear/1 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_ImageHelper.SetColorSpaceToSRGB/1 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_ImageHelper.TEMP_SaveImageDataWrapper/4 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_PrefabHelper.CreatePrefabFromXOB/4 | subsumed-by | subsumed-by wb_resources.prefabFromModel (own handler code: the helper calls FileIO.MakeDirectory and FileIO.FileExists, OD-5) (proposal docs/v2/inbox/w2/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_resources.prefabFromModel at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:SCR_PrefabHelper.CreatePrefabsFromXOBs/4 | subsumed-by | subsumed-by wb_resources.prefabFromModel (own handler code: the helper calls FileIO.FileExists and FileIO.MakeDirectory, OD-5) (proposal docs/v2/inbox/w2/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_resources.prefabFromModel at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:SCR_SnapAndOrientToTerrainPlugin.Run/0 | blocked | blocked:P-W6-05 until this class passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| api:SCR_TerrainEntityVariantReplacementPlugin.ButtonCancel/0 | subsumed-by | subsumed-by api:SCR_TerrainEntityVariantReplacementPlugin (run through wb_cli_run only, OD-9) (proposal docs/v2/inbox/w7/remainder.jsonl; api:SCR_TerrainEntityVariantReplacementPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_TerrainEntityVariantReplacementPlugin.ButtonOK/0 | subsumed-by | subsumed-by api:SCR_TerrainEntityVariantReplacementPlugin (run through wb_cli_run only, OD-9) (proposal docs/v2/inbox/w7/remainder.jsonl; api:SCR_TerrainEntityVariantReplacementPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_TerrainEntityVariantReplacementPlugin.ConvertCurrentTerrain/2 | subsumed-by | subsumed-by api:SCR_TerrainEntityVariantReplacementPlugin (run through wb_cli_run only, OD-9) (proposal docs/v2/inbox/w7/remainder.jsonl; api:SCR_TerrainEntityVariantReplacementPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_TerrainEntityVariantReplacementPlugin.ConvertCurrentTerrainMeasured/2 | subsumed-by | subsumed-by api:SCR_TerrainEntityVariantReplacementPlugin (run through wb_cli_run only, OD-9) (proposal docs/v2/inbox/w7/remainder.jsonl; api:SCR_TerrainEntityVariantReplacementPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_TerrainEntityVariantReplacementPlugin.CreateEntities/1 | subsumed-by | subsumed-by api:SCR_TerrainEntityVariantReplacementPlugin (run through wb_cli_run only, OD-9) (proposal docs/v2/inbox/w7/remainder.jsonl; api:SCR_TerrainEntityVariantReplacementPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_TerrainEntityVariantReplacementPlugin.DebugDuplication/0 | subsumed-by | subsumed-by api:SCR_TerrainEntityVariantReplacementPlugin (run through wb_cli_run only, OD-9) (proposal docs/v2/inbox/w7/remainder.jsonl; api:SCR_TerrainEntityVariantReplacementPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_TerrainEntityVariantReplacementPlugin.DeleteEntities/2 | subsumed-by | subsumed-by api:SCR_TerrainEntityVariantReplacementPlugin (run through wb_cli_run only, OD-9) (proposal docs/v2/inbox/w7/remainder.jsonl; api:SCR_TerrainEntityVariantReplacementPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_TerrainEntityVariantReplacementPlugin.GetCLIConfig/2 | subsumed-by | subsumed-by api:SCR_TerrainEntityVariantReplacementPlugin (run through wb_cli_run only, OD-9) (proposal docs/v2/inbox/w7/remainder.jsonl; api:SCR_TerrainEntityVariantReplacementPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_TerrainEntityVariantReplacementPlugin.GetCLIParameterValues/4 | subsumed-by | subsumed-by api:SCR_TerrainEntityVariantReplacementPlugin (run through wb_cli_run only, OD-9) (proposal docs/v2/inbox/w7/remainder.jsonl; api:SCR_TerrainEntityVariantReplacementPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_TerrainEntityVariantReplacementPlugin.GetCLIVariant/2 | subsumed-by | subsumed-by api:SCR_TerrainEntityVariantReplacementPlugin (run through wb_cli_run only, OD-9) (proposal docs/v2/inbox/w7/remainder.jsonl; api:SCR_TerrainEntityVariantReplacementPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_TerrainEntityVariantReplacementPlugin.GetCLIWorldPath/2 | subsumed-by | subsumed-by api:SCR_TerrainEntityVariantReplacementPlugin (run through wb_cli_run only, OD-9) (proposal docs/v2/inbox/w7/remainder.jsonl; api:SCR_TerrainEntityVariantReplacementPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_TerrainEntityVariantReplacementPlugin.GetCreationData/1 | subsumed-by | subsumed-by api:SCR_TerrainEntityVariantReplacementPlugin (run through wb_cli_run only, OD-9) (proposal docs/v2/inbox/w7/remainder.jsonl; api:SCR_TerrainEntityVariantReplacementPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_TerrainEntityVariantReplacementPlugin.GetNewWorldFilePath/2 | subsumed-by | subsumed-by api:SCR_TerrainEntityVariantReplacementPlugin (run through wb_cli_run only, OD-9) (proposal docs/v2/inbox/w7/remainder.jsonl; api:SCR_TerrainEntityVariantReplacementPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_TerrainEntityVariantReplacementPlugin.GetentitiesToProcess/1 | subsumed-by | subsumed-by api:SCR_TerrainEntityVariantReplacementPlugin (run through wb_cli_run only, OD-9) (proposal docs/v2/inbox/w7/remainder.jsonl; api:SCR_TerrainEntityVariantReplacementPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_TerrainEntityVariantReplacementPlugin.LoadConfig/2 | subsumed-by | subsumed-by api:SCR_TerrainEntityVariantReplacementPlugin (run through wb_cli_run only, OD-9) (proposal docs/v2/inbox/w7/remainder.jsonl; api:SCR_TerrainEntityVariantReplacementPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_TerrainEntityVariantReplacementPlugin.Run/0 | subsumed-by | subsumed-by api:SCR_TerrainEntityVariantReplacementPlugin (run through wb_cli_run only, OD-9) (proposal docs/v2/inbox/w7/remainder.jsonl; api:SCR_TerrainEntityVariantReplacementPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_TerrainEntityVariantReplacementPlugin.RunCommandline/0 | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| api:SCR_TerrainEntityVariantReplacementPlugin.SetAncestor/2 | subsumed-by | subsumed-by api:SCR_TerrainEntityVariantReplacementPlugin (run through wb_cli_run only, OD-9) (proposal docs/v2/inbox/w7/remainder.jsonl; api:SCR_TerrainEntityVariantReplacementPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_WorldEditorToolHelper.GetTriangle2DAreaAboveOceanLevel/4 | not-automatable | OD-8 (EV-W1-120): protected static callback or helper | EV-W1-120 |
| api:SCR_WorldEditorToolHelper.QueryEntitiesCallbackMethod/1 | not-automatable | OD-8 (EV-W1-120): protected static callback or helper | EV-W1-120 |
| api:SCR_WorldEditorToolHelper.TraceCallbackMethod/3 | not-automatable | OD-8 (EV-W1-120): protected static callback or helper | EV-W1-120 |
| api:SCR_WorldEntitiesStatisticsPlugin.ButtonAnalyse/0 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_WorldEntitiesStatisticsPlugin.ButtonClose/0 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_WorldEntitiesStatisticsPlugin.CreateDensityImage/5 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_WorldEntitiesStatisticsPlugin.CreateVarietyImage/6 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_WorldEntitiesStatisticsPlugin.GetFormattedMapLines/3 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_WorldEntitiesStatisticsPlugin.GetReportLines/1 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_WorldEntitiesStatisticsPlugin.OutputLines/2 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_WorldEntitiesStatisticsPlugin.Run/0 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_WorldEntitiesStatisticsPlugin.ScanWorld/0 | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (re-implemented: wb_world_tools.stats) (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_WorldFilesHelper.GetDefaultLayerAbsoluteFilePath/1 | not-automatable | OD-8 (EV-W1-120): protected static, callable only inside the class | EV-W1-120 |
| api:SCR_WorldFilesHelper.ReRegisterMetaFiles/2 | not-automatable | OD-8 (EV-W1-120): protected static, callable only inside the class | EV-W1-120 |
| api:SCR_WrapEntitiesPlugin.Run/0 | blocked | blocked:P-W6-05 until this class passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| api:WorldDataExport.ExportWorldData/5 | subsumed-by | subsumed-by plugin:WorldDataExport (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldDataExport at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldDataExport.RunCommandline/0 | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| api:WorldEditorAPI.BeginTerrainAction/3 | absent-in-build | OD-8 (EV-W1-120): 1.9.0.37 declares BeginTerrainAction/2 | EV-W1-120 |
| api:WorldEditorAPI.CreateEntityInWindow/6 | not-automatable | OD-8 (EV-W1-120): needs a RenderTargetWidget no handler can obtain; CreateEntityInWindowEx/6 covers the feature (wb_view.placeAtPixel | EV-W1-120 |
| api:WorldEditorAPI.ModifyHeightMap/6 | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:WorldEditorAPI.ModifyHeightMapUserShape/6 | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:WorldEditorAPI.ModifyLayers/6 | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:WorldEditorAPI.ModifyLayersUserShape/6 | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.AddAssetToMigrate/3 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.ButtonExport/0 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.ClearExportSourceData/0 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.CloneEntityFull/2 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.ClonePrefabFast/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.ClonePrefabSlow/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.CloneSingleEntity/4 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.Configure/0 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (wb_plugin never calls Configure) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.CopyComponent/3 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.CopyComponents/2 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.CopyContainerProperties/4 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.CopyContainerPropertiesSpecial/5 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.CopyEntityProperties/2 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.DeepPrefabEntityCloneRecur/3 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.DeleteFilePlus/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.DiscoverMeshObjectMaterialOverrides/2 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.DoesEntityNeedReplacing/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.DoesPrefabNeedReplacing/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.DoesPrefabNeedReplacingFast/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.ExportFile/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.ExportFiles/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.ExportMapData/0 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.ExportSharedData/0 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.FindComponentSource/2 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.GetAlternateClassName/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.GetConfig/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.GetMaterialsFromXobs/0 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.GetPrefab/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.GetPrefabName/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.GetTexturesFromMaterials/0 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.Init/0 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.InitVars/0 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.IsAnyComponentIncompatible/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.IsComponentClassBlacklisted/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.IsEntityClassBlacklisted/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.IsExportTargetFolderEmpty/0 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.IsFromPrefabLibrary/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.IsPartOfPrefab/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.LogTimedEnd/2 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.LogTimedStart/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.OnAfterEntityCloned/2 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.OnAfterEntityProcessed/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.OnAfterEntityReparented/2 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.OnBeforeEntityProcessed/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.PerformExport/0 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.PerformResourceExport/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.PrintLogs/0 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.ProcessDiscoveredPrefabs/0 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.ProcessEntityRecur/4 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.RegisterGamemat/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.RegisterMaterial/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.RegisterNewPrefab/2 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.RegisterPrefabXob/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.RegisterXob/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.Run/0 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldExporterPlugin.RunPrefabDiscovery/1 | subsumed-by | subsumed-by plugin:WorldExporterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| file:.ct | blocked | blocked:P-W2-24 (BaseContainer text? then config_edit.read) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| file:file-type/Object import CSV | subsumed-by | The CSV object-import format has no file row and is read by SCR_ObjectImportPlugin; driving the import is driving the plugin. | EV-s001-003 |
| file:file-type/Shapefile .shp import %2F geo export | subsumed-by | The .shp format has no file row and is read by SCR_ImportShapefilePlugin, so driving the import is driving the plugin; the row's label also names the geo export side (SCR_ExportGeoDataPlugin), which this target does not cover. | EV-s001-003 |
| mcp:handler-action/EMCP_WB_GetEntity.run | absent-in-build | OD-1 (EV-W1-121): the 1.x handler EMCP_WB_GetEntity is removed; nothing called it | EV-W1-121 |
| mcp:handler-action/EMCP_WB_ListEntities.run | absent-in-build | OD-1 (EV-W1-121): the 1.x handler EMCP_WB_ListEntities is removed; nothing called it | EV-W1-121 |
| plugin:CameraOrientationTool | blocked | blocked:P-W6-05 until this class passes its run probe (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:EntityOrientationTool | blocked | blocked:P-W6-05 until this class passes its run probe (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:SCR_AddPrefabToSelectedEntitiesPlugin | blocked | blocked:P-W6-05 until this class passes its run probe (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:SCR_CreateEditablePrefabsPlugin | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| plugin:SCR_CreateEditablePrefabsPlugin#button:ButtonClose | subsumed-by | subsumed-by plugin:SCR_CreateEditablePrefabsPlugin (dialog button) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_CreateEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SCR_SnapAndOrientToTerrainPlugin | blocked | blocked:P-W6-05 until this class passes its run probe (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:SCR_TerrainEntityVariantReplacementPlugin | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| plugin:SCR_TerrainEntityVariantReplacementPlugin#button:ButtonCancel | subsumed-by | subsumed-by plugin:SCR_TerrainEntityVariantReplacementPlugin (dialog button) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_TerrainEntityVariantReplacementPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SCR_TerrainEntityVariantReplacementPlugin#button:ButtonOK | subsumed-by | subsumed-by plugin:SCR_TerrainEntityVariantReplacementPlugin (dialog button) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_TerrainEntityVariantReplacementPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SCR_WorldEntitiesStatisticsPlugin | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| plugin:SCR_WorldEntitiesStatisticsPlugin#attr:m_bDebug | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (option with no W6 parameter: display, file output, vanilla UI or generator data; OD-10) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SCR_WorldEntitiesStatisticsPlugin#attr:m_bHeatmapHighlightValuesAboveMax | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (option with no W6 parameter: display, file output, vanilla UI or generator data; OD-10) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SCR_WorldEntitiesStatisticsPlugin#attr:m_bHeatmapValueInversion | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (option with no W6 parameter: display, file output, vanilla UI or generator data; OD-10) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SCR_WorldEntitiesStatisticsPlugin#attr:m_bOutputHeatmapForAllLayers | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (option with no W6 parameter: display, file output, vanilla UI or generator data; OD-10) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SCR_WorldEntitiesStatisticsPlugin#attr:m_bOutputToFile | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (option with no W6 parameter: display, file output, vanilla UI or generator data; OD-10) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SCR_WorldEntitiesStatisticsPlugin#attr:m_iDisplayThreshold | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (option with no W6 parameter: display, file output, vanilla UI or generator data; OD-10) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SCR_WorldEntitiesStatisticsPlugin#attr:m_iHeatmapColourMode | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (option with no W6 parameter: display, file output, vanilla UI or generator data; OD-10) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SCR_WorldEntitiesStatisticsPlugin#attr:m_iHeatmapDefinition | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (option with no W6 parameter: display, file output, vanilla UI or generator data; OD-10) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SCR_WorldEntitiesStatisticsPlugin#attr:m_iHeatmapMaxValueMode | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (option with no W6 parameter: display, file output, vanilla UI or generator data; OD-10) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SCR_WorldEntitiesStatisticsPlugin#attr:m_iHeatmapType | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (option with no W6 parameter: display, file output, vanilla UI or generator data; OD-10) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SCR_WorldEntitiesStatisticsPlugin#button:ButtonAnalyse | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (dialog button of a re-implemented plugin) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SCR_WorldEntitiesStatisticsPlugin#button:ButtonClose | subsumed-by | subsumed-by plugin:SCR_WorldEntitiesStatisticsPlugin (dialog button of a re-implemented plugin) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SCR_WrapEntitiesPlugin | blocked | blocked:P-W6-05 until this class passes its run probe (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:WorldExporterPlugin | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| plugin:WorldExporterPlugin#button:ButtonExport | subsumed-by | subsumed-by plugin:WorldExporterPlugin (dialog button) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/Build shore map | duplicate-of | duplicate-of:plugin:BuildShoreMap (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:BuildShoreMap at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/Map Exporter | duplicate-of | duplicate-of:plugin:WorldExporterPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/Regenerate river flow-maps | duplicate-of | duplicate-of:plugin:GenerateFlowMaps (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:GenerateFlowMaps at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/Terrain Entity Variant Replacement | duplicate-of | duplicate-of:plugin:SCR_TerrainEntityVariantReplacementPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_TerrainEntityVariantReplacementPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/World Data Export Plugin | duplicate-of | duplicate-of:plugin:WorldDataExport (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldDataExport at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/World Entities Statistics | duplicate-of | duplicate-of:plugin:SCR_WorldEntitiesStatisticsPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/WorldTest Plugin | duplicate-of | duplicate-of:plugin:WorldTestPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldTestPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| ui:WorldEditor/context-item/Hierarchy/default/Delete | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:WorldEditor/context-item/Hierarchy/entity/Delete | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:WorldEditor/context-item/Resource Browser/folder/Delete | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:WorldEditor/context-item/Viewport/Delete | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:WorldEditor/control/User Profile/@WBEditBox.1 | excluded-policy | DEC-056 ruling 15: risk credential (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:WorldEditor/control/User Profile/@WBEditBox.2 | excluded-policy | DEC-056 ruling 15: risk credential (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:WorldEditor/control/User Profile/Forgot Password? | excluded-policy | DEC-056 ruling 15: risk credential (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:WorldEditor/control/Vector Tool/Delete | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:WorldEditor/menu-item/File/Exit | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:WorldEditor/menu-item/File/Force Save All | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:WorldEditor/menu-item/File/New World | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:WorldEditor/menu-item/File/Save World As | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:WorldEditor/menu-item/Plugins/Settings/Clear All Settings | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:WorldEditor/menu-item/Window/Reset Default Layouts | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:WorldEditor/menu/Entities/Delete | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:WorldEditor/shortcut/World Editor/New World | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:WorldEditor/toolbar-button/toolBar/New World | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
