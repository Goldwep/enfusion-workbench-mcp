# Census: Shared

5347 rows (0 aggregate excluded).

## What it is

Module Shared: api 1020, diag 1611, net 6, plugin 234, schema 2350, setting 23, ui 103. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- class AnimExportProfileChannels (api:AnimExportProfileChannels)
- class AnimExportProfileChannelsRequest (api:AnimExportProfileChannelsRequest)
- class AnimExportProfileChannelsResponse (api:AnimExportProfileChannelsResponse)
- class AnimExportProfiles (api:AnimExportProfiles)
- class AnimExportProfilesRequest (api:AnimExportProfilesRequest)
- class AnimExportProfilesResponse (api:AnimExportProfilesResponse)
- class AnimExportTrackExport (api:AnimExportTrackExport)
- class AnimExportTrackExportRequest (api:AnimExportTrackExportRequest)
- class AnimExportTrackExportResponse (api:AnimExportTrackExportResponse)
- class AnimationExportProfileChannelInfo (api:AnimationExportProfileChannelInfo)
- class AnimationProfileCollector (api:AnimationProfileCollector)
- class AssetTypes (api:AssetTypes)
- ... 593 more

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| api | 0 | 53 | 903 | 64 | 0 | 0 | 1020 |
| diag | 0 | 0 | 1443 | 168 | 0 | 0 | 1611 |
| net | 0 | 0 | 6 | 0 | 0 | 0 | 6 |
| plugin | 0 | 0 | 234 | 0 | 0 | 0 | 234 |
| schema | 0 | 6 | 2344 | 0 | 0 | 0 | 2350 |
| setting | 23 | 0 | 0 | 0 | 0 | 0 | 23 |
| ui | 3 | 17 | 83 | 0 | 0 | 0 | 103 |

## By kind

- attribute: 111
- canvas-gesture: 14
- class: 244
- control: 9
- debug-panel: 1
- diag-menu: 154
- diag-option: 1457
- dialog: 7
- enum: 26
- enum-value: 103
- event: 5
- hazard-dialog: 2
- method: 469
- net-field: 5
- net-handler: 1
- option: 2
- plugin: 11
- plugin-button: 53
- plugin-cli-arg: 12
- plugin-setting: 143
- property-editor: 32
- schema-class: 361
- schema-key: 1989
- setting-key: 21
- shortcut: 38
- static-method: 62
- tool: 15

## By risk

- destructive: 16
- mutating: 1846
- safe: 3485

## Rows by kind

### attribute (111)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:AssetTypes#attr:m_aAssetTypes | T2/T2 | candidate: net-api-handler | none |
| api:BlenderPathContainer#attr:m_sPath | T1/T2 | candidate: net-api-handler | none |
| api:EBTGameMaterialSettings#attr:color | T2/T2 | candidate: net-api-handler | none |
| api:EBTGameMaterialSettings#attr:gameMaterial | T2/T2 | candidate: net-api-handler | none |
| api:EBTProjectSettings#attr:gameMaterialSettings | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsComponent_Base#attr:m_Component | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsComponent_EditableEntity#attr:m_EntityCoreConfigPrefab | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsComponent_EditableEntity#attr:m_EntityLabelRules | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsComponent_EditableEntity#attr:m_ImagePlaceholder | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsComponent_EditableEntity#attr:m_ImagesDirectory | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsComponent_EditableEntity#attr:m_bUpdateBudgets | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsComponent_EditableEntity#attr:m_sLocKeyFormat | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsComponent_EditableEntity#attr:m_sNameFormat | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsComponent_PreviewEntity#attr:m_bRuntime | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsConfig#attr:m_Settings | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsConfig#attr:m_SourceDirectory | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsConfig#attr:m_SupportEntities | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsConfig#attr:m_TargetDirectory | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsConfig#attr:m_sAutoFolderName | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsConfig#attr:m_sFileNamePrefix | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsConfig#attr:m_sSourceBlacklist | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsLabel_Base#attr:m_Label | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsLabel_CharacterRole#attr:m_MedicItemCountRequired | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsLabel_EntityType#attr:m_EntityType | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsLabel_Faction#attr:m_FactionToCheck | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsLabel_GroupSize#attr:m_GroupSizeLarge | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsLabel_GroupSize#attr:m_GroupSizeMedium | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsLabel_GroupSize#attr:m_GroupSizeSmall | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsLabel_Size#attr:m_DebugPrintSize | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsLabel_Size#attr:m_IgnoreY | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsLabel_Size#attr:sizeL | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsLabel_Size#attr:sizeM | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsLabel_Size#attr:sizeS | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsLabel_Size#attr:sizeXL | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsLabel_Size#attr:sizeXS | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsLabel_Theme#attr:m_FolderName | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsLabel_VehicleType#attr:m_APCArmorValue | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsLabel_VehicleType#attr:m_TruckMassValue | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsSetting#attr:m_Components | T2/T2 | candidate: net-api-handler | none |
| api:EditablePrefabsSetting#attr:m_Target | T2/T2 | candidate: net-api-handler | none |

71 more: wb_census find with module=Shared kind=attribute.

### canvas-gesture (14)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:Shared/canvas-gesture/MeasureTool/KeyPress KC_ESCAPE | T2/T2 | candidate: gui-automation | none |
| ui:Shared/canvas-gesture/MeasureTool/MouseMove | T2/T2 | candidate: gui-automation | none |
| ui:Shared/canvas-gesture/MeasureTool/MousePress | T2/T2 | candidate: gui-automation | none |
| ui:Shared/canvas-gesture/SCR_AutoSpawnerTool/MouseMove | T2/T2 | candidate: gui-automation | none |
| ui:Shared/canvas-gesture/SCR_AutoSpawnerTool/MousePress | T2/T2 | candidate: gui-automation | none |
| ui:Shared/canvas-gesture/SCR_PrefabBoneSnappingTool/KeyPress KC_ESCAPE | T2/T2 | candidate: gui-automation | none |
| ui:Shared/canvas-gesture/SCR_PrefabBoneSnappingTool/Leave | T2/T2 | candidate: gui-automation | none |
| ui:Shared/canvas-gesture/SCR_PrefabBoneSnappingTool/MouseMove | T2/T2 | candidate: gui-automation | none |
| ui:Shared/canvas-gesture/SCR_PrefabBoneSnappingTool/MousePress | T2/T2 | candidate: gui-automation | none |
| ui:Shared/canvas-gesture/SCR_ShapeBrushTool/Leave | T2/T2 | candidate: gui-automation | none |
| ui:Shared/canvas-gesture/SCR_ShapeBrushTool/MouseMove | T2/T2 | candidate: gui-automation | none |
| ui:Shared/canvas-gesture/SCR_ShapeBrushTool/MousePress LEFT | T2/T2 | candidate: gui-automation | none |
| ui:Shared/canvas-gesture/SCR_ShapeBrushTool/MouseRelease LEFT | T2/T2 | candidate: gui-automation | none |
| ui:Shared/canvas-gesture/SCR_ShapeBrushTool/Wheel CONTROL | T2/T2 | candidate: gui-automation | none |

### class (244)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:AnimExportProfileChannels | T2/T2 | candidate: none-known | none |
| api:AnimExportProfileChannelsRequest | T2/T2 | candidate: none-known | none |
| api:AnimExportProfileChannelsResponse | T2/T2 | candidate: none-known | none |
| api:AnimExportProfiles | T2/T2 | candidate: none-known | none |
| api:AnimExportProfilesRequest | T2/T2 | candidate: none-known | none |
| api:AnimExportProfilesResponse | T2/T2 | candidate: none-known | none |
| api:AnimExportTrackExport | T2/T2 | candidate: none-known | none |
| api:AnimExportTrackExportRequest | T2/T2 | candidate: none-known | none |
| api:AnimExportTrackExportResponse | T2/T2 | candidate: none-known | none |
| api:AnimationExportProfileChannelInfo | T2/T2 | candidate: none-known | none |
| api:AnimationProfileCollector | T2/T2 | candidate: none-known | none |
| api:AssetTypes | T2/T2 | candidate: none-known | none |
| api:BakeInfo | T2/T2 | candidate: none-known | none |
| api:BakeInfoDialog | T2/T2 | candidate: none-known | none |
| api:BakeInfoRequest | T2/T2 | candidate: none-known | none |
| api:BakeInfoResponse | T2/T2 | candidate: none-known | none |
| api:BakeMLODResult | T2/T2 | candidate: none-known | none |
| api:BakeXOBMlodRequest | T2/T2 | candidate: none-known | none |
| api:BaseContainerCustomTitleBlenderVersion | T1/T2 | candidate: none-known | none |
| api:BlenderOperatorDescription | T2/T2 | candidate: none-known | none |
| api:BlenderPathContainer | T1/T2 | candidate: none-known | none |
| api:BlenderRestAPI | T2/T2 | candidate: none-known | none |
| api:BuildResourceContext | T2/T2 | candidate: none-known | none |
| api:BuildShoreMap | T2/T2 | candidate: none-known | none |
| api:ButtonAttribute | T2/T2 | candidate: none-known | none |
| api:CheckGUID | T2/T2 | candidate: none-known | none |
| api:CheckGUIDRequest | T2/T2 | candidate: none-known | none |
| api:CheckGUIDResponse | T2/T2 | candidate: none-known | none |
| api:ContainerID | T2/T2 | candidate: none-known | none |
| api:ContainerJSONSerializer | T2/T2 | candidate: none-known | none |
| api:DateTimeUtcAsInt | T2/T2 | candidate: none-known | none |
| api:DynMaterialTemplate | T2/T2 | candidate: none-known | none |
| api:EBTAddonInfo | T2/T2 | candidate: none-known | none |
| api:EBTContainerFields | T2/T2 | candidate: none-known | none |
| api:EBTEmatUtils | T2/T2 | candidate: none-known | none |
| api:EBTGameMaterialSettings | T2/T2 | candidate: none-known | none |
| api:EBTInfo | T2/T2 | candidate: none-known | none |
| api:EBTInfoDialog | T2/T2 | candidate: none-known | none |
| api:EBTInfoRequest | T2/T2 | candidate: none-known | none |
| api:EBTProjectSettings | T2/T2 | candidate: none-known | none |

204 more: wb_census find with module=Shared kind=class.

### control (9)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:Shared/control/AI Debug Panel/Breakpoint | T1/T5 | candidate: gui-automation | none |
| ui:Shared/control/AI Debug Panel/Call sign | T1/T5 | candidate: gui-automation | none |
| ui:Shared/control/AI Debug Panel/Current action | T1/T5 | candidate: gui-automation | none |
| ui:Shared/control/AI Debug Panel/Dump Debug Msgs | T1/T5 | candidate: gui-automation | none |
| ui:Shared/control/AI Debug Panel/List of available actions and their priority | T1/T5 | candidate: gui-automation | none |
| ui:Shared/control/AI Debug Panel/Locate | T1/T5 | candidate: gui-automation | none |
| ui:Shared/control/AI Debug Panel/Threat level | T1/T5 | candidate: gui-automation | none |
| ui:Shared/control/AI Debug Panel/Unit roles | T1/T5 | candidate: gui-automation | none |
| ui:Shared/control/AI Debug Panel/Unit states | T1/T5 | candidate: gui-automation | none |

### debug-panel (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:Shared/debug-panel/AI Debug Panel | T1/T2 | candidate: gui-automation | none |

### diag-menu (154)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| diag:AI | T2/T2 | candidate: gui-automation | none |
| diag:AI/AI Navigator | T2/T2 | candidate: gui-automation | none |
| diag:AI/AIScript | T3/T2 | candidate: gui-automation | [wb_diag.select](../tools/wb_diag.md) drive |
| diag:AI/Aiming | T2/T2 | candidate: gui-automation | none |
| diag:AI/Animals | T2/T2 | candidate: gui-automation | none |
| diag:AI/Driving | T2/T2 | candidate: gui-automation | none |
| diag:AI/Movement | T2/T2 | candidate: gui-automation | none |
| diag:AI/Navmesh | T2/T2 | candidate: gui-automation | none |
| diag:AI/POV Pathfinder | T2/T2 | candidate: gui-automation | none |
| diag:AI/Pathfinding | T2/T2 | candidate: gui-automation | none |
| diag:AI/Perception | T2/T2 | candidate: gui-automation | none |
| diag:AI/Performance | T2/T2 | candidate: gui-automation | none |
| diag:Animation | T2/T2 | candidate: gui-automation | none |
| diag:Character | T2/T2 | candidate: gui-automation | none |
| diag:Character/Character physics | T2/T2 | candidate: gui-automation | none |
| diag:Cheats | T2/T2 | candidate: gui-automation | none |
| diag:Conflict | T3/T2 | candidate: gui-automation | [wb_diag.select](../tools/wb_diag.md) drive |
| diag:Conflict/Military Supply Allocation | T3/T2 | candidate: gui-automation | [wb_diag.select](../tools/wb_diag.md) drive |
| diag:ECS | T2/T2 | candidate: gui-automation | none |
| diag:Editor | T3/T2 | candidate: gui-automation | [wb_diag.select](../tools/wb_diag.md) drive |
| diag:Editor/Actions Menu | T3/T2 | candidate: gui-automation | [wb_diag.select](../tools/wb_diag.md) drive |
| diag:Editor/Editable Entities | T3/T2 | candidate: gui-automation | [wb_diag.select](../tools/wb_diag.md) drive |
| diag:Editor/Editor GUI | T3/T2 | candidate: gui-automation | [wb_diag.select](../tools/wb_diag.md) drive |
| diag:Editor/Transforming | T3/T2 | candidate: gui-automation | [wb_diag.select](../tools/wb_diag.md) drive |
| diag:Game | T2/T2 | candidate: gui-automation | none |
| diag:Game/Deployable SpawnPoints | T3/T2 | candidate: gui-automation | [wb_diag.select](../tools/wb_diag.md) drive |
| diag:Game/Dialogue | T2/T2 | candidate: gui-automation | none |
| diag:Game/Voting | T3/T2 | candidate: gui-automation | [wb_diag.select](../tools/wb_diag.md) drive |
| diag:Game/Weather | T2/T2 | candidate: gui-automation | none |
| diag:GameCode | T2/T2 | candidate: gui-automation | none |
| diag:GameCode/Achievements | T2/T2 | candidate: gui-automation | none |
| diag:GameCode/Animations | T2/T2 | candidate: gui-automation | none |
| diag:GameCode/Camera | T2/T2 | candidate: gui-automation | none |
| diag:GameCode/Chat | T2/T2 | candidate: gui-automation | none |
| diag:GameCode/Damage | T2/T2 | candidate: gui-automation | none |
| diag:GameCode/Damage/Destruction | T2/T2 | candidate: gui-automation | none |
| diag:GameCode/Damage/Hit Zones | T2/T2 | candidate: gui-automation | none |
| diag:GameCode/Electricity | T2/T2 | candidate: gui-automation | none |
| diag:GameCode/Game materials | T2/T2 | candidate: gui-automation | none |
| diag:GameCode/Gamepad | T2/T2 | candidate: gui-automation | none |

114 more: wb_census find with module=Shared kind=diag-menu.

### diag-option (1457)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| diag:AI/AI Navigator/Enabled | T2/T2 | candidate: gui-automation, net-api-handler | none |
| diag:AI/AI Navigator/Next agent | T2/T2 | candidate: gui-automation, net-api-handler | none |
| diag:AI/AI Navigator/Previous agent | T2/T2 | candidate: gui-automation, net-api-handler | none |
| diag:AI/AI Units | T2/T2 | candidate: gui-automation, net-api-handler | none |
| diag:AI/AIScript/AI Debug Category | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Debug cover search | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Open Debug Panel | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Print debug from BTs | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Print init of groups | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Print new activity | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Print stats for aiming | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Select fixed AIAgent | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Set BT Breakpoint | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Show Comms Handlers | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Show Grenade Trace | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Show Send Message Menu | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Show aim leading debug | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Show debug shapes from BTs | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Show fiendly in aim | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Show fireteams | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Show grenade positions | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Show illum flares positions | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Show perception panel | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Show search and destroy points of interest | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Show sector threat filter | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Show subgroups | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Show suppression debug | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Show target clusters | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/AIScript/Show target last seen | T3/T2 | candidate: gui-automation, net-api-handler | [wb_diag.get](../tools/wb_diag.md) read |
| diag:AI/Aiming/Aiming component | T2/T2 | candidate: gui-automation, net-api-handler | none |
| diag:AI/Aiming/Aiming component PID | T2/T2 | candidate: gui-automation, net-api-handler | none |
| diag:AI/Aiming/Head aiming component | T2/T2 | candidate: gui-automation, net-api-handler | none |
| diag:AI/Aiming/Show target aimpoint | T2/T2 | candidate: gui-automation, net-api-handler | none |
| diag:AI/Aiming/Show target projected size | T2/T2 | candidate: gui-automation, net-api-handler | none |
| diag:AI/Aiming/Use aim at version of ai aiming | T2/T2 | candidate: gui-automation, net-api-handler | none |
| diag:AI/Animals/Draw Animal despawn range | T2/T2 | candidate: gui-automation, net-api-handler | none |
| diag:AI/Animals/Draw Animal to Animal minimum spawn range | T2/T2 | candidate: gui-automation, net-api-handler | none |
| diag:AI/Animals/Draw tile boundaries | T2/T2 | candidate: gui-automation, net-api-handler | none |
| diag:AI/Animals/Manager to debug | T2/T2 | candidate: gui-automation, net-api-handler | none |
| diag:AI/Animals/Show animals debug info | T2/T2 | candidate: gui-automation, net-api-handler | none |

1417 more: wb_census find with module=Shared kind=diag-option.

### dialog (7)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:Shared/dialog/UIWidgets/ColorPicker/popup | T1/T3 | candidate: gui-automation | none |
| ui:Shared/dialog/UIWidgets/CurveDialog/popup | T1/T3 | candidate: gui-automation | none |
| ui:Shared/dialog/UIWidgets/EditBoxMultiline/popup | T1/T3 | candidate: gui-automation | none |
| ui:Shared/dialog/UIWidgets/FileNamePicker/popup | T0/T3 | candidate: gui-automation | none |
| ui:Shared/dialog/UIWidgets/GradientDialog/popup | T1/T3 | candidate: gui-automation | none |
| ui:Shared/dialog/UIWidgets/ResourceNamePicker/popup | T0/T3 | candidate: gui-automation | none |
| ui:Shared/dialog/UIWidgets/ResourcePickerThumbnail/popup | T0/T3 | candidate: gui-automation | none |

### enum (26)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:BlenderRestAPIState | T2/T2 | candidate: none-known | none |
| api:EBTBlenderPathStatus | T2/T2 | candidate: none-known | none |
| api:ETerrainNoiseType | T1/T2 | candidate: none-known | none |
| api:ExportStatus | T2/T2 | candidate: none-known | none |
| api:ExporterAssetType | T2/T2 | candidate: none-known | none |
| api:FilterMorphLerpFunc | T1/T2 | candidate: none-known | none |
| api:FilterMorphOperation | T1/T2 | candidate: none-known | none |
| api:FilterMorphShape | T1/T2 | candidate: none-known | none |
| api:FixRayMissExtents | T2/T2 | candidate: none-known | none |
| api:FixRayMissType | T2/T2 | candidate: none-known | none |
| api:GeoAttribType | T2/T2 | candidate: none-known | none |
| api:GeoShapeType | T2/T2 | candidate: none-known | none |
| api:InfoStatus | T2/T2 | candidate: none-known | none |
| api:MetaEddsColorSpaceConversion | T2/T2 | candidate: none-known | none |
| api:MetaEddsConversion | T2/T2 | candidate: none-known | none |
| api:MetaEddsMipMapFilter | T2/T2 | candidate: none-known | none |
| api:ModifierKey | T2/T2 | candidate: none-known | none |
| api:SCR_EEditablePrefabResult | T2/T2 | candidate: none-known | none |
| api:TerrainToolType | T1/T2 | candidate: none-known | none |
| api:TextureCheckResult | T2/T2 | candidate: none-known | none |
| api:TextureIssueOp | T2/T2 | candidate: none-known | none |
| api:TxaErrCode | T2/T2 | candidate: none-known | none |
| api:TxaErrorCode | T2/T2 | candidate: none-known | none |
| api:UserShapeFilter | T1/T2 | candidate: none-known | none |
| api:WETMouseButtonFlag | T2/T2 | candidate: none-known | none |
| api:WorldRunConfiguration | T2/T2 | candidate: none-known | none |

### enum-value (103)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:BlenderRestAPIState.ERROR | T2/T2 | candidate: none-known | none |
| api:BlenderRestAPIState.SUCCESS | T2/T2 | candidate: none-known | none |
| api:BlenderRestAPIState.WAITING | T2/T2 | candidate: none-known | none |
| api:EBTBlenderPathStatus.NOT_CONFIGURED | T2/T2 | candidate: none-known | none |
| api:EBTBlenderPathStatus.NOT_FOUND | T2/T2 | candidate: none-known | none |
| api:EBTBlenderPathStatus.OK | T2/T2 | candidate: none-known | none |
| api:ETerrainNoiseType.PERLIN | T1/T2 | candidate: none-known | none |
| api:ETerrainNoiseType.RANDOM | T1/T2 | candidate: none-known | none |
| api:ExportStatus.ERROR | T2/T2 | candidate: none-known | none |
| api:ExportStatus.OK | T2/T2 | candidate: none-known | none |
| api:ExporterAssetType.GAMEMAT | T2/T2 | candidate: none-known | none |
| api:ExporterAssetType.MAT | T2/T2 | candidate: none-known | none |
| api:ExporterAssetType.MISC | T2/T2 | candidate: none-known | none |
| api:ExporterAssetType.PREFAB | T2/T2 | candidate: none-known | none |
| api:ExporterAssetType.TXT | T2/T2 | candidate: none-known | none |
| api:ExporterAssetType.XOB | T2/T2 | candidate: none-known | none |
| api:FilterMorphLerpFunc.INV_COS | T1/T2 | candidate: none-known | none |
| api:FilterMorphLerpFunc.INV_SPHERE | T1/T2 | candidate: none-known | none |
| api:FilterMorphLerpFunc.LINEAR | T1/T2 | candidate: none-known | none |
| api:FilterMorphLerpFunc.SIN | T1/T2 | candidate: none-known | none |
| api:FilterMorphLerpFunc.SMOOTH | T1/T2 | candidate: none-known | none |
| api:FilterMorphLerpFunc.SPHERE | T1/T2 | candidate: none-known | none |
| api:FilterMorphOperation.ADD | T1/T2 | candidate: none-known | none |
| api:FilterMorphOperation.COMBINE | T1/T2 | candidate: none-known | none |
| api:FilterMorphOperation.EXACT | T1/T2 | candidate: none-known | none |
| api:FilterMorphOperation.NOISE | T1/T2 | candidate: none-known | none |
| api:FilterMorphOperation.NONCUMULATIVE | T1/T2 | candidate: none-known | none |
| api:FilterMorphOperation.SMOOTH | T1/T2 | candidate: none-known | none |
| api:FilterMorphShape.ROUND | T1/T2 | candidate: none-known | none |
| api:FilterMorphShape.SQUARE | T1/T2 | candidate: none-known | none |
| api:FilterMorphShape.USER | T1/T2 | candidate: none-known | none |
| api:FixRayMissExtents.BROAD | T2/T2 | candidate: none-known | none |
| api:FixRayMissExtents.MINIMUM | T2/T2 | candidate: none-known | none |
| api:FixRayMissType.FAST | T2/T2 | candidate: none-known | none |
| api:FixRayMissType.SMOOTH_CAGE_BAKE | T2/T2 | candidate: none-known | none |
| api:GeoAttribType.FLT | T2/T2 | candidate: none-known | none |
| api:GeoAttribType.INT | T2/T2 | candidate: none-known | none |
| api:GeoAttribType.STR | T2/T2 | candidate: none-known | none |
| api:GeoAttribType.UNKNOWN | T2/T2 | candidate: none-known | none |
| api:GeoShapeType.MULTI_POINT | T2/T2 | candidate: none-known | none |

63 more: wb_census find with module=Shared kind=enum-value.

### event (5)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:BuildResourceContext.IsWorking/0 | T2/T5 | candidate: net-api-handler | none |
| api:WorkbenchPlugin.Configure/0 | T2/T5 | candidate: net-api-handler | none |
| api:WorkbenchPlugin.OnResourceContextMenu/1 | T2/T5 | candidate: net-api-handler | none |
| api:WorkbenchPlugin.Run/0 | T3/T5 | candidate: net-api-handler | [wb_plugin.run](../tools/wb_plugin.md) drive |
| api:WorkbenchPlugin.RunCommandline/0 | T2/T2 | candidate: net-api-handler | none |

### hazard-dialog (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:Shared/hazard-dialog/Addon dependency can't be added | T1/T2 | candidate: gui-automation | none |
| ui:Shared/hazard-dialog/Crash report result | T1/T2 | candidate: gui-automation | none |

### method (469)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:AnimExportProfileChannels.GetRequest/0 | T2/T5 | candidate: net-api-handler | none |
| api:AnimExportProfileChannels.GetResponse/1 | T2/T5 | candidate: net-api-handler | none |
| api:AnimExportProfileChannelsRequest.AnimExportProfileChannelsRequest/0 | T2/T5 | candidate: net-api-handler | none |
| api:AnimExportProfileChannelsResponse.OnPack/0 | T2/T5 | candidate: net-api-handler | none |
| api:AnimExportProfiles.GetRequest/0 | T2/T5 | candidate: net-api-handler | none |
| api:AnimExportProfiles.GetResponse/1 | T2/T5 | candidate: net-api-handler | none |
| api:AnimExportProfilesRequest.AnimExportProfilesRequest/0 | T2/T5 | candidate: net-api-handler | none |
| api:AnimExportProfilesResponse.OnPack/0 | T2/T5 | candidate: net-api-handler | none |
| api:AnimExportTrackExport.GetRequest/0 | T2/T5 | candidate: net-api-handler | none |
| api:AnimExportTrackExport.GetResponse/1 | T2/T5 | candidate: net-api-handler | none |
| api:AnimExportTrackExportRequest.AnimExportTrackExportRequest/0 | T2/T5 | candidate: net-api-handler | none |
| api:AnimExportTrackExportResponse.AnimExportTrackExportResponse/0 | T2/T5 | candidate: net-api-handler | none |
| api:AnimationExportProfileChannelInfo.AnimationExportProfileChannelInfo/2 | T2/T5 | candidate: net-api-handler | none |
| api:AnimationProfileCollector.OnFound/2 | T2/T5 | candidate: net-api-handler | none |
| api:AssetTypes.GetData/1 | T2/T5 | candidate: net-api-handler | none |
| api:BakeInfo.GetRequest/0 | T2/T5 | candidate: net-api-handler | none |
| api:BakeInfo.GetResponse/1 | T2/T5 | candidate: net-api-handler | none |
| api:BakeInfoDialog.OkButton/0 | T2/T5 | candidate: net-api-handler | none |
| api:BakeInfoRequest.BakeInfoRequest/0 | T2/T5 | candidate: net-api-handler | none |
| api:BakeInfoResponse.BakeInfoResponse/0 | T2/T5 | candidate: net-api-handler | none |
| api:BakeXOBMlodRequest.BakeXOBMlodRequest/0 | T2/T5 | candidate: net-api-handler | none |
| api:BaseContainerCustomTitleBlenderVersion.BaseContainerCustomTitleBlenderVersion/1 | T1/T5 | candidate: net-api-handler | none |
| api:BaseContainerCustomTitleBlenderVersion._WB_GetCustomTitle/2 | T1/T5 | candidate: net-api-handler | none |
| api:BlenderOperatorDescription.AddParam/2 | T2/T5 | candidate: net-api-handler | none |
| api:BlenderOperatorDescription.BlenderOperatorDescription/2 | T2/T5 | candidate: net-api-handler | none |
| api:BlenderOperatorDescription.OnPack/0 | T2/T5 | candidate: net-api-handler | none |
| api:BlenderRestAPI.Destroy/0 | T2/T5 | candidate: net-api-handler | none |
| api:BlenderRestAPI.Get/2 | T2/T5 | candidate: net-api-handler | none |
| api:BlenderRestAPI.OnRestErrorCallback/1 | T2/T5 | candidate: net-api-handler | none |
| api:BlenderRestAPI.OnRestSuccessCallback/1 | T2/T5 | candidate: net-api-handler | none |
| api:BlenderRestAPI.Post/3 | T2/T5 | candidate: net-api-handler | none |
| api:BuildShoreMap.RunCommandline/0 | T2/T2 | candidate: net-api-handler | none |
| api:ButtonAttribute.ButtonAttribute/2 | T2/T5 | candidate: net-api-handler | none |
| api:CheckGUID.GetRequest/0 | T2/T5 | candidate: net-api-handler | none |
| api:CheckGUID.GetResponse/1 | T2/T5 | candidate: net-api-handler | none |
| api:CheckGUIDRequest.CheckGUIDRequest/0 | T2/T5 | candidate: net-api-handler | none |
| api:CheckGUIDResponse.CheckGUIDResponse/0 | T2/T5 | candidate: net-api-handler | none |
| api:ContainerID.GetOrCreateDirectPtr/1 | T2/T5 | candidate: net-api-handler | none |
| api:DateTimeUtcAsInt.GetDay/0 | T3/T5 | candidate: net-api-handler | [wb_diag.info](../tools/wb_diag.md) read |
| api:DateTimeUtcAsInt.GetHour/0 | T3/T5 | candidate: net-api-handler | [wb_diag.info](../tools/wb_diag.md) read |

429 more: wb_census find with module=Shared kind=method.

### net-field (5)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| net:handler/OverrideMeshObjectMaterial#req:materialAbsPath | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/OverrideMeshObjectMaterial#req:prefabAbsPath | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/OverrideMeshObjectMaterial#req:sourceMaterial | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/OverrideMeshObjectMaterial#req:textureAbsPath | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/OverrideMeshObjectMaterial#resp:Output | T2/T2 | candidate: builtin-net-handler | none |

### net-handler (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| net:handler/OverrideMeshObjectMaterial | T2/T5 | candidate: builtin-net-handler | [wb_bi.describe](../tools/wb_bi.md) read, [wb_bi.list](../tools/wb_bi.md) read |

### option (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| setting:Workbench/AutoRebuildScripts | T0/T5 | candidate: file-format, gui-automation | none |
| setting:Workbench/NetAPI_Enabled | T0/T5 | candidate: file-format, gui-automation | none |

### plugin (11)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:BuildShoreMap | T2/T2 | candidate: plugin-run | none |
| plugin:GenerateFlowMaps | T2/T2 | candidate: plugin-run | none |
| plugin:ResourceTestPlugin | T2/T2 | candidate: plugin-run | none |
| plugin:SCR_AutotestPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BIKIExportTerrainStatisticsPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_EditableEntityMaintenancePlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_TracyPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_UpdateAllEditablePrefabsPlugin | T2/T2 | candidate: plugin-run | none |
| plugin:SCR_VCSSettingsPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:WorldDataExport | T2/T2 | candidate: plugin-run | none |
| plugin:WorldTestPlugin | T2/T2 | candidate: plugin-run | none |

### plugin-button (53)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:SCR_AutoSpawnerTool#button:FolderScan | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_AutoSpawnerTool#button:SpawnFromPrefabList | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_AutoSpawnerTool#button:Undo | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_AutotestTool#button:ButtonRunClass | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_AutotestTool#button:ButtonRunGroup | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BIKIExportTerrainStatisticsPlugin#button:ButtonCancel | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BIKIExportTerrainStatisticsPlugin#button:ButtonOK | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BatchPrefabsOperationsTool#button:Execute | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BatchPrefabsOperationsTool#button:ExecuteModify | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BuildingDestructionSetupTool#button:BtnFixBuildingPrefabRuins | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BuildingDestructionSetupTool#button:BtnSetBuildingDestructionEffects | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_CoordsTool#button:AddEntry | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_CoordsTool#button:NavigateToClipboardLink | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_CoordsTool#button:NavigateToCoords | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DestructiblePrefabFinderTool#button:FolderScan | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DestructiblePrefabFinderTool#button:PrintDestructibleEntities | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DestructiblePrefabFinderTool#button:PrintDestructibleEntitiesWithMPD | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DestructiblePrefabFinderTool#button:PrintMPDComponents | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DestructiblePrefabFinderTool#button:PrintMPDComponentsMissingHitZone | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DestructiblePrefabFinderTool#button:PrintMPDComponentsMissingRpl | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DestructiblePrefabFinderTool#button:PrintMPDComponentsWithDefaults | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DestructionIndicesAssignTool#button:AssignIndicesButton | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DestructionIndicesAssignTool#button:ConvertPrefabsButton | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DestructionIndicesAssignTool#button:FilterPrefabsButton | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DestructionIndicesAssignTool#button:FixPhasesButton | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DestructionIndicesAssignTool#button:PrintAllDestructibleResourceNamesButton | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DestructionIndicesAssignTool#button:RemovePhasesButton | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DestructionIndicesAssignTool#button:RevertToParentButton | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DestructionIndicesAssignTool#button:SetBuildingDestructionEffectButton | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DestructionIndicesAssignTool#button:ShowMassButton | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DestructionIndicesAssignTool#button:UpdatePrefabsButton | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_EditableEntityMaintenancePlugin#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_EditableEntityMaintenancePlugin#button:ButtonRun | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_GenerateWindowsPrefabsTool#button:CreateFramesButton | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_GenerateWindowsPrefabsTool#button:CreateGlassButton | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_GenerateWindowsPrefabsTool#button:CreateSashesButton | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_GenerateWindowsPrefabsTool#button:UpdateSashPrefabs | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_GenerateWindowsPrefabsTool#button:UpdateWindowPrefabs | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ParallelShapeTool#button:Run | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_PrefabBoneSnappingTool#button:ButtonOpenPrefabInEditMode | T2/T5 | candidate: plugin-run | none |

13 more: wb_census find with module=Shared kind=plugin-button.

### plugin-cli-arg (12)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:BuildShoreMap#cli:-exitafter | T2/T5 | candidate: cli | none |
| plugin:BuildShoreMap#cli:-world | T2/T5 | candidate: cli | none |
| plugin:GenerateFlowMaps#cli:-exitafter | T2/T5 | candidate: cli | none |
| plugin:GenerateFlowMaps#cli:-world | T2/T5 | candidate: cli | none |
| plugin:ResourceTestPlugin#cli:-autotest-output-dir | T2/T5 | candidate: cli | none |
| plugin:ResourceTestPlugin#cli:-resources | T2/T5 | candidate: cli | none |
| plugin:WorldDataExport#cli:-excludehills | T2/T5 | candidate: cli | none |
| plugin:WorldDataExport#cli:-savedir | T2/T5 | candidate: cli | none |
| plugin:WorldDataExport#cli:-type | T2/T5 | candidate: cli | none |
| plugin:WorldDataExport#cli:-world | T2/T5 | candidate: cli | none |
| plugin:WorldTestPlugin#cli:-wait | T2/T5 | candidate: cli | none |
| plugin:WorldTestPlugin#cli:-world | T2/T5 | candidate: cli | none |

### plugin-setting (143)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:MeasureTool#attr:m_bCheckAgainstEntities | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutoSpawnerTool#attr:m_bAlignByBoundingBox | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutoSpawnerTool#attr:m_bFindEntities | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutoSpawnerTool#attr:m_bFindXOBs | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutoSpawnerTool#attr:m_bGenerateComment | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutoSpawnerTool#attr:m_bShowPlacement | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutoSpawnerTool#attr:m_fCommentYOffset | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutoSpawnerTool#attr:m_fCumulativeRotation | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutoSpawnerTool#attr:m_fXOffset | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutoSpawnerTool#attr:m_fYOffset | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutoSpawnerTool#attr:m_fZOffset | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutoSpawnerTool#attr:m_iObjectsPerRow | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutoSpawnerTool#attr:m_iSpawnMultiplier | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutoSpawnerTool#attr:m_sPrefabList | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutotestPlugin#attr:m_bFocusWorldEditor | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutotestPlugin#attr:m_bOpenDialogAfterRun | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutotestPlugin#attr:m_bOpenLogAfterRun | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutotestPlugin#attr:m_bVerboseLog | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutotestPlugin#attr:m_eActionAfterRun | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutotestTool#attr:m_bArguments | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutotestTool#attr:m_bRunInNewWindow | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutotestTool#attr:m_sExePath | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutotestTool#attr:m_sTestClass | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutotestTool#attr:m_sTestGroup | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BIKIExportTerrainStatisticsPlugin#attr:m_bEnableEntityStatistics | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BIKIExportTerrainStatisticsPlugin#attr:m_fMapDescriptorSearchRadius | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BIKIExportTerrainStatisticsPlugin#attr:m_fTerrainMeasurementResolution | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BatchPrefabsOperationsTool#attr:m_aModelsToProcess | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BatchPrefabsOperationsTool#attr:m_aNewNames | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BatchPrefabsOperationsTool#attr:m_aPrefabsToProcess | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BatchPrefabsOperationsTool#attr:m_bGenerateNames | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BatchPrefabsOperationsTool#attr:m_iAddonToUse | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BatchPrefabsOperationsTool#attr:m_sBaseClass | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BatchPrefabsOperationsTool#attr:m_sDirectoryToProcess | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BatchPrefabsOperationsTool#attr:m_sPathToSave | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BatchPrefabsOperationsTool#attr:m_sPrefabConfig | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BuildingDestructionSetupTool#attr:m_DestructionEffectsConfig | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_CoordsTool#attr:m_aEntries | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_CoordsTool#attr:m_bUseFullLink | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_CoordsTool#attr:m_sMapCoordinates | T2/T4 | candidate: plugin-run | none |

103 more: wb_census find with module=Shared kind=plugin-setting.

### property-editor (32)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:Shared/property-editor/UIWidgets/Auto | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/BoundingVolumeEditor | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/Button | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/CheckBox | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/ColorPicker | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/ComboBox | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/Coords | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/CurveDialog | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/Date | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/EditBox | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/EditBoxMultiline | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/EditBoxWithButton | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/EditComboBox | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/FileNamePicker | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/Flags | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/Font | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/GradientDialog | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/Graph | T1/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/Hidden | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/LODFactorsEdit | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/LocaleEditBox | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/None | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/Object | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/Range | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/ResourceAssignArray | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/ResourceNamePicker | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/ResourcePickerThumbnail | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/Script | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/SearchComboBox | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/Slider | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/SpinBox | T2/T3 | candidate: gui-automation | none |
| ui:Shared/property-editor/UIWidgets/TopLevelObject | T2/T3 | candidate: gui-automation | none |

### schema-class (361)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:AimPoint | T2/T2 | candidate: file-format | none |
| schema:AmplitudeClass | T2/T2 | candidate: file-format | none |
| schema:AnimationAttachmentInfo | T2/T2 | candidate: file-format | none |
| schema:AttachPoint | T2/T2 | candidate: file-format | none |
| schema:AuxSelectorClass | T2/T2 | candidate: file-format | none |
| schema:AvailableActionLayoutBehavior | T2/T2 | candidate: file-format | none |
| schema:BaseExplosionDamage | T2/T2 | candidate: file-format | none |
| schema:BaseFireMode | T2/T2 | candidate: file-format | none |
| schema:BaseNavmeshFilesConfig | T2/T2 | candidate: file-format | none |
| schema:BiquadDSPTypeClass | T2/T2 | candidate: file-format | none |
| schema:BitCrusherDSPTypeClass | T2/T2 | candidate: file-format | none |
| schema:CargoCompartmentSlot | T2/T2 | candidate: file-format | none |
| schema:CharacterModifierAttributes | T2/T2 | candidate: file-format | none |
| schema:CompartmentAccessibilityContext | T2/T2 | candidate: file-format | none |
| schema:CompartmentDoorInfo | T2/T2 | candidate: file-format | none |
| schema:CompressorDSPTypeClass | T2/T2 | candidate: file-format | none |
| schema:ConnectionClass | T2/T2 | candidate: file-format | none |
| schema:ConnectionsClass | T2/T2 | candidate: file-format | none |
| schema:CurveCubicSplineFloat | T2/T2 | candidate: file-format | none |
| schema:CurvePoint | T2/T2 | candidate: file-format | none |
| schema:DetailsPanelContentPresetConfig | T2/T2 | candidate: file-format | none |
| schema:Differential | T2/T2 | candidate: file-format | none |
| schema:DistortionDSPTypeClass | T2/T2 | candidate: file-format | none |
| schema:EmissiveLightSurfaceSlot | T2/T2 | candidate: file-format | none |
| schema:Engine | T2/T2 | candidate: file-format | none |
| schema:EntitySlotInfo | T2/T2 | candidate: file-format | none |
| schema:Equalizer4DSPTypeClass | T2/T2 | candidate: file-format | none |
| schema:ExplosionDamageContainer | T2/T2 | candidate: file-format | none |
| schema:ExplosionFragmentationEffect | T2/T2 | candidate: file-format | none |
| schema:ExplosionImpulseEffect | T2/T2 | candidate: file-format | none |
| schema:FilterClass | T2/T2 | candidate: file-format | none |
| schema:FrequencyClass | T2/T2 | candidate: file-format | none |
| schema:GamepadEffectCollection | T2/T2 | candidate: file-format | none |
| schema:GamepadRumbleEffect | T2/T2 | candidate: file-format | none |
| schema:GamepadTriggerEffect | T2/T2 | candidate: file-format | none |
| schema:Gearbox | T2/T2 | candidate: file-format | none |
| schema:GroupClass | T2/T2 | candidate: file-format | none |
| schema:GroupWeaponFiremode | T2/T2 | candidate: file-format | none |
| schema:IOPCompiledClass | T2/T2 | candidate: file-format | none |
| schema:IOPCompiledIn | T2/T2 | candidate: file-format | none |

321 more: wb_census find with module=Shared kind=schema-class.

### schema-key (1989)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:AimPoint.AimPointPosition | T2/T2 | candidate: file-format | none |
| schema:AimPoint.AimPointType | T2/T2 | candidate: file-format | none |
| schema:AimPoint.AimpointChecked | T2/T2 | candidate: file-format | none |
| schema:AimPoint.Dimension | T2/T2 | candidate: file-format | none |
| schema:AimPoint.VsibilityChecked | T2/T2 | candidate: file-format | none |
| schema:AmplitudeClass.AttenuationCurve | T2/T2 | candidate: file-format | none |
| schema:AmplitudeClass.DirectivityCurve | T2/T2 | candidate: file-format | none |
| schema:AmplitudeClass.EnableDirectivity | T2/T2 | candidate: file-format | none |
| schema:AmplitudeClass.comment | T2/T2 | candidate: file-format | none |
| schema:AmplitudeClass.ctl | T2/T2 | candidate: file-format | none |
| schema:AmplitudeClass.curve | T2/T2 | candidate: file-format | none |
| schema:AmplitudeClass.id | T2/T2 | candidate: file-format | none |
| schema:AmplitudeClass.innerRange | T2/T2 | candidate: file-format | none |
| schema:AmplitudeClass.name | T2/T2 | candidate: file-format | none |
| schema:AmplitudeClass.outerRange | T2/T2 | candidate: file-format | none |
| schema:AmplitudeClass.parent | T2/T2 | candidate: file-format | none |
| schema:AmplitudeClass.slopeFactor | T2/T2 | candidate: file-format | none |
| schema:AmplitudeClass.tl | T2/T2 | candidate: file-format | none |
| schema:AmplitudeClass.varName | T2/T2 | candidate: file-format | none |
| schema:AmplitudeClass.varResource | T2/T2 | candidate: file-format | none |
| schema:AmplitudeClass.version | T2/T2 | candidate: file-format | none |
| schema:AnimationAttachmentInfo.AnimGraph | T2/T2 | candidate: file-format | none |
| schema:AnimationAttachmentInfo.AnimInstance | T2/T2 | candidate: file-format | none |
| schema:AnimationAttachmentInfo.BindingName | T2/T2 | candidate: file-format | none |
| schema:AuxSelectorClass.id | T2/T2 | candidate: file-format | none |
| schema:AuxSelectorClass.ins | T2/T2 | candidate: file-format | none |
| schema:AuxSelectorClass.name | T2/T2 | candidate: file-format | none |
| schema:AuxSelectorClass.parent | T2/T2 | candidate: file-format | none |
| schema:AuxSelectorClass.ports | T2/T2 | candidate: file-format | none |
| schema:AuxSelectorClass.tl | T2/T2 | candidate: file-format | none |
| schema:AuxSelectorClass.version | T2/T2 | candidate: file-format | none |
| schema:AvailableActionLayoutBehavior.m_bOffsetFromDisplay | T2/T2 | candidate: file-format | none |
| schema:AvailableActionLayoutBehavior.m_fAddOffset | T2/T2 | candidate: file-format | none |
| schema:AvailableActionLayoutBehavior.m_fOffsetY | T2/T2 | candidate: file-format | none |
| schema:AvailableActionLayoutBehavior.m_sCheckHUD | T2/T2 | candidate: file-format | none |
| schema:BaseExplosionDamage.DamageDistance | T2/T2 | candidate: file-format | none |
| schema:BaseExplosionDamage.DamageEffect | T2/T2 | candidate: file-format | none |
| schema:BaseExplosionDamage.DamageFalloffCurve | T2/T2 | candidate: file-format | none |
| schema:BaseExplosionDamage.DamageType | T2/T2 | candidate: file-format | none |
| schema:BaseExplosionDamage.DamageValue | T2/T2 | candidate: file-format | none |

1949 more: wb_census find with module=Shared kind=schema-key.

### setting-key (21)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| setting:Music Editor/legacyOptionsLoaded | T0/T3 | candidate: file-format | none |
| setting:Workbench%2FFileDialog/splitterState | T0/T3 | candidate: file-format | none |
| setting:Workbench%2FPropertyGrid%2FProjectSettingsGridCommon/SplitterPos | T0/T3 | candidate: file-format | none |
| setting:Workbench%2FPropertyGrid%2FProjectSettingsGridConf/SplitterPos | T0/T3 | candidate: file-format | none |
| setting:Workbench%2FPropertyGrid%2FanimEditorPropGrid/Node Properties | T0/T3 | candidate: file-format | none |
| setting:Workbench%2FPropertyGrid%2FanimEditorPropGrid/SplitterPos | T0/T3 | candidate: file-format | none |
| setting:Workbench%2FPropertyGrid%2FanimEditorPropGridDebugControls/SplitterPos | T0/T3 | candidate: file-format | none |
| setting:Workbench%2FPropertyGrid%2FanimEditorPropGridIkTesting/SplitterPos | T0/T3 | candidate: file-format | none |
| setting:Workbench%2FPropertyGrid%2Fcontrols/Commands | T0/T3 | candidate: file-format | none |
| setting:Workbench%2FPropertyGrid%2Fcontrols/SplitterPos | T0/T3 | candidate: file-format | none |
| setting:Workbench%2FPropertyGrid%2Fcontrols/Variables | T0/T3 | candidate: file-format | none |
| setting:Workbench%2FPropertyGrid%2FemitterPropGrid/SplitterPos | T0/T3 | candidate: file-format | none |
| setting:Workbench%2FPropertyGrid%2FentityPropGrid/General>editor | T0/T3 | candidate: file-format | none |
| setting:Workbench%2FPropertyGrid%2FentityPropGrid/SplitterPos | T0/T3 | candidate: file-format | none |
| setting:Workbench%2FPropertyGrid%2FmaterialPropGrid/SplitterPos | T0/T3 | candidate: file-format | none |
| setting:Workbench%2FPropertyGrid%2FpropertyGridControlTemplate/SplitterPos | T0/T3 | candidate: file-format | none |
| setting:Workbench%2FPropertyGrid%2FtoolPropGrid/SplitterPos | T0/T3 | candidate: file-format | none |
| setting:Workbench%2FScriptDialog%2FValidateFBXPlugin/geometry | T0/T3 | candidate: file-format | none |
| setting:Workbench%2FWeatherTool/disableGeo | T0/T3 | candidate: file-format | none |
| setting:Workbench%2FWeatherTool/geometry | T0/T3 | candidate: file-format | none |
| setting:Workbench/legacyOptionsLoaded | T0/T3 | candidate: file-format | none |

### shortcut (38)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:Shared/shortcut/Camera/Move Backward | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Camera/Move Down | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Camera/Move Forward | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Camera/Move Left | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Camera/Move Right | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Camera/Move Up | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Common/Close Tab | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Common/Create New Layout | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Common/Cycle Tabs | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Common/Focus Selection | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Common/Manage Layouts | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Common/Move | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Common/Next Tab | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Common/Previous Tab | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Common/Redo | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Common/Rename | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Common/Reopen Closed Tab | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Common/Reset Default Layouts | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Common/Rotate | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Common/Scale | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Common/Toggle Gizmo Space | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Common/Undo | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Compass Gizmo/Back Face | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Compass Gizmo/Bottom Face | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Compass Gizmo/Front Face | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Compass Gizmo/Left Face | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Compass Gizmo/Reset POI | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Compass Gizmo/Right Face | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Compass Gizmo/Switch Projection | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Compass Gizmo/Top Face | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Compass Gizmo/X Minus 15 | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Compass Gizmo/X Plus 15 | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Compass Gizmo/Y Minus 15 | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Compass Gizmo/Y Plus 15 | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Resource Browser/Navigate Back | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Resource Browser/Navigate Forward | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Resource Browser/Navigate Up | T2/T2 | candidate: gui-automation | none |
| ui:Shared/shortcut/Resource Browser/New Folder | T2/T2 | candidate: gui-automation | none |

### static-method (62)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:BlenderPathContainer.GetTitleFromPath/2 | T1/T5 | candidate: net-api-handler | none |
| api:BlenderRestAPI.Create/1 | T2/T5 | candidate: net-api-handler | none |
| api:ContainerJSONSerializer.WriteVars/3 | T2/T5 | candidate: net-api-handler | none |
| api:EBT_HTTPRequest.DefaultOnError/1 | T1/T5 | candidate: net-api-handler | none |
| api:EBT_HTTPRequest.Send/4 | T1/T5 | candidate: net-api-handler | none |
| api:EditablePrefabsConfig.GetConfig/1 | T2/T5 | candidate: net-api-handler | none |
| api:ExportMaterialResource.CopyParamsToEmatContainer/2 | T2/T5 | candidate: net-api-handler | none |
| api:GeoShapeLoader.LoadShapeFile/1 | T2/T5 | candidate: net-api-handler | none |
| api:LoadedProjects.InLoadedProjects/1 | T2/T5 | candidate: net-api-handler | none |
| api:MlodBakeJob.CreateTexturePathFromMaterialAbsolutePath/2 | T2/T5 | candidate: net-api-handler | none |
| api:MlodBakeJob.GetTextureSavePath/2 | T2/T5 | candidate: net-api-handler | none |
| api:MlodBakeJob.SaveBakedTexture/3 | T2/T5 | candidate: net-api-handler | none |
| api:MlodBakeJob.SetFilePathExtension/2 | T2/T5 | candidate: net-api-handler | none |
| api:ParamEnumSuperSampling.FromEnum/0 | T2/T5 | candidate: net-api-handler | none |
| api:ParamEnumTextureImportSize.FromEnum/0 | T2/T5 | candidate: net-api-handler | none |
| api:ParamEnumTextureSize.FromEnum/0 | T2/T5 | candidate: net-api-handler | none |
| api:PrefabImporterBake.GetBaseFBX/2 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceInfo.CreateFromMetaFile/2 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceInfo.CreateFromString/2 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceInfo.CreateSourceFileNotFoundmessage/1 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceUtils.GetAbsolutePathForResourceName/1 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceUtils.GetMaterialAssignsFromXOBMeta/1 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceUtils.GetMaterialClassName/1 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceUtils.GetMetaFileForPath/1 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceUtils.GetMetaFileForResourceName/1 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceUtils.GetMlodMaterialResourceFromXOBMeta/2 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceUtils.GetResourceNameForAbsolutePath/1 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceUtils.GetTextureResourceFromMaterialSlot/2 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceUtils.RegisterTextureResource/2 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceUtils.WaitForResourceFile/2 | T2/T5 | candidate: net-api-handler | none |
| api:RestAPIHelper.Get/2 | T2/T5 | candidate: net-api-handler | none |
| api:RestAPIHelper.Post/3 | T2/T5 | candidate: net-api-handler | none |
| api:TexTools.RepairTerrainTextureBorders/3 | T2/T5 | candidate: net-api-handler | none |
| api:TexTools.SaveImageData/4 | T2/T5 | candidate: net-api-handler | none |
| api:TextureResourceInfo.GetPostFix/1 | T2/T5 | candidate: net-api-handler | none |
| api:Workbench.CloseModule/1 | T2/T5 | candidate: net-api-handler | none |
| api:Workbench.Dialog/3 | T2/T5 | candidate: net-api-handler | none |
| api:Workbench.Exit/1 | T2/T2 | candidate: net-api-handler | none |
| api:Workbench.FinishProcess/1 | T2/T5 | candidate: net-api-handler | none |
| api:Workbench.GenerateGloballyUniqueID64/0 | T3/T5 | candidate: net-api-handler | [wb_resources.newGuid](../tools/wb_resources.md) read |

22 more: wb_census find with module=Shared kind=static-method.

### tool (15)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:MeasureTool | T2/T5 | candidate: gui-automation, plugin-run | none |
| plugin:SCR_AutoSpawnerTool | T2/T5 | candidate: gui-automation, plugin-run | none |
| plugin:SCR_AutotestTool | T2/T5 | candidate: gui-automation, plugin-run | none |
| plugin:SCR_BatchPrefabsOperationsTool | T2/T5 | candidate: gui-automation, plugin-run | none |
| plugin:SCR_BuildingDestructionSetupTool | T2/T5 | candidate: gui-automation, plugin-run | none |
| plugin:SCR_CoordsTool | T2/T5 | candidate: gui-automation, plugin-run | none |
| plugin:SCR_DestructiblePrefabFinderTool | T2/T5 | candidate: gui-automation, plugin-run | none |
| plugin:SCR_DestructionIndicesAssignTool | T2/T5 | candidate: gui-automation, plugin-run | none |
| plugin:SCR_GenerateWindowsPrefabsTool | T2/T5 | candidate: gui-automation, plugin-run | none |
| plugin:SCR_ParallelShapeTool | T2/T5 | candidate: gui-automation, plugin-run | none |
| plugin:SCR_PrefabBoneSnappingTool | T2/T5 | candidate: gui-automation, plugin-run | none |
| plugin:SCR_PrefabManagementTool | T2/T5 | candidate: gui-automation, plugin-run | none |
| plugin:SCR_ShapeAreaTool | T2/T5 | candidate: gui-automation, plugin-run | none |
| plugin:SCR_ShapeBrushTool | T2/T5 | candidate: gui-automation, plugin-run | none |
| plugin:SCR_WorldMapExportTool | T2/T5 | candidate: gui-automation, plugin-run | none |

## Below target (883)

- T0 to T3: 24
- T0 to T5: 2
- T1 to T2: 56
- T1 to T3: 5
- T1 to T5: 15
- T2 to T3: 31
- T2 to T4: 143
- T2 to T5: 543
- T3 to T5: 64

| id | tier | path |
| --- | --- | --- |
| api:AnimExportProfileChannels.GetRequest/0 | T2/T5 | candidate: net-api-handler |
| api:AnimExportProfileChannels.GetResponse/1 | T2/T5 | candidate: net-api-handler |
| api:AnimExportProfileChannelsRequest.AnimExportProfileChannelsRequest/0 | T2/T5 | candidate: net-api-handler |
| api:AnimExportProfileChannelsResponse.OnPack/0 | T2/T5 | candidate: net-api-handler |
| api:AnimExportProfiles.GetRequest/0 | T2/T5 | candidate: net-api-handler |
| api:AnimExportProfiles.GetResponse/1 | T2/T5 | candidate: net-api-handler |
| api:AnimExportProfilesRequest.AnimExportProfilesRequest/0 | T2/T5 | candidate: net-api-handler |
| api:AnimExportProfilesResponse.OnPack/0 | T2/T5 | candidate: net-api-handler |
| api:AnimExportTrackExport.GetRequest/0 | T2/T5 | candidate: net-api-handler |
| api:AnimExportTrackExport.GetResponse/1 | T2/T5 | candidate: net-api-handler |
| api:AnimExportTrackExportRequest.AnimExportTrackExportRequest/0 | T2/T5 | candidate: net-api-handler |
| api:AnimExportTrackExportResponse.AnimExportTrackExportResponse/0 | T2/T5 | candidate: net-api-handler |
| api:AnimationExportProfileChannelInfo.AnimationExportProfileChannelInfo/2 | T2/T5 | candidate: net-api-handler |
| api:AnimationProfileCollector.OnFound/2 | T2/T5 | candidate: net-api-handler |
| api:AssetTypes.GetData/1 | T2/T5 | candidate: net-api-handler |
| api:BakeInfo.GetRequest/0 | T2/T5 | candidate: net-api-handler |
| api:BakeInfo.GetResponse/1 | T2/T5 | candidate: net-api-handler |
| api:BakeInfoDialog.OkButton/0 | T2/T5 | candidate: net-api-handler |
| api:BakeInfoRequest.BakeInfoRequest/0 | T2/T5 | candidate: net-api-handler |
| api:BakeInfoResponse.BakeInfoResponse/0 | T2/T5 | candidate: net-api-handler |
| api:BakeXOBMlodRequest.BakeXOBMlodRequest/0 | T2/T5 | candidate: net-api-handler |
| api:BaseContainerCustomTitleBlenderVersion | T1/T2 | candidate: none-known |
| api:BaseContainerCustomTitleBlenderVersion.BaseContainerCustomTitleBlenderVersion/1 | T1/T5 | candidate: net-api-handler |
| api:BaseContainerCustomTitleBlenderVersion._WB_GetCustomTitle/2 | T1/T5 | candidate: net-api-handler |
| api:BlenderOperatorDescription.AddParam/2 | T2/T5 | candidate: net-api-handler |
| api:BlenderOperatorDescription.BlenderOperatorDescription/2 | T2/T5 | candidate: net-api-handler |
| api:BlenderOperatorDescription.OnPack/0 | T2/T5 | candidate: net-api-handler |
| api:BlenderPathContainer | T1/T2 | candidate: none-known |
| api:BlenderPathContainer#attr:m_sPath | T1/T2 | candidate: net-api-handler |
| api:BlenderPathContainer.GetTitleFromPath/2 | T1/T5 | candidate: net-api-handler |
| api:BlenderRestAPI.Create/1 | T2/T5 | candidate: net-api-handler |
| api:BlenderRestAPI.Destroy/0 | T2/T5 | candidate: net-api-handler |
| api:BlenderRestAPI.Get/2 | T2/T5 | candidate: net-api-handler |
| api:BlenderRestAPI.OnRestErrorCallback/1 | T2/T5 | candidate: net-api-handler |
| api:BlenderRestAPI.OnRestSuccessCallback/1 | T2/T5 | candidate: net-api-handler |
| api:BlenderRestAPI.Post/3 | T2/T5 | candidate: net-api-handler |
| api:BuildResourceContext.IsWorking/0 | T2/T5 | candidate: net-api-handler |
| api:ButtonAttribute.ButtonAttribute/2 | T2/T5 | candidate: net-api-handler |
| api:CheckGUID.GetRequest/0 | T2/T5 | candidate: net-api-handler |
| api:CheckGUID.GetResponse/1 | T2/T5 | candidate: net-api-handler |
| api:CheckGUIDRequest.CheckGUIDRequest/0 | T2/T5 | candidate: net-api-handler |
| api:CheckGUIDResponse.CheckGUIDResponse/0 | T2/T5 | candidate: net-api-handler |
| api:ContainerID.GetOrCreateDirectPtr/1 | T2/T5 | candidate: net-api-handler |
| api:ContainerJSONSerializer.WriteVars/3 | T2/T5 | candidate: net-api-handler |
| api:DateTimeUtcAsInt.GetDay/0 | T3/T5 | candidate: net-api-handler |
| api:DateTimeUtcAsInt.GetHour/0 | T3/T5 | candidate: net-api-handler |
| api:DateTimeUtcAsInt.GetMinute/0 | T3/T5 | candidate: net-api-handler |
| api:DateTimeUtcAsInt.GetMonth/0 | T3/T5 | candidate: net-api-handler |
| api:DateTimeUtcAsInt.GetSecond/0 | T3/T5 | candidate: net-api-handler |
| api:DateTimeUtcAsInt.GetYear/0 | T3/T5 | candidate: net-api-handler |
| api:DynMaterialTemplate.DynMaterialTemplate/0 | T2/T5 | candidate: net-api-handler |
| api:EBTAddonInfo.EBTAddonInfo/0 | T2/T5 | candidate: net-api-handler |
| api:EBTEmatUtils.GetMaterials/2 | T2/T5 | candidate: net-api-handler |
| api:EBTInfo.GetRequest/0 | T2/T5 | candidate: net-api-handler |
| api:EBTInfo.GetResponse/1 | T2/T5 | candidate: net-api-handler |
| api:EBTInfoDialog.OkButton/0 | T2/T5 | candidate: net-api-handler |
| api:EBTInfoRequest.EBTInfoRequest/0 | T2/T5 | candidate: net-api-handler |
| api:EBT_HTTPErrorResponse | T1/T2 | candidate: none-known |
| api:EBT_HTTPErrorResponse.EBT_HTTPErrorResponse/0 | T1/T5 | candidate: net-api-handler |
| api:EBT_HTTPRequest | T1/T2 | candidate: none-known |

823 more: wb_census find with module=Shared.

## Dispositions (189)

| id | kind | why | evidence |
| --- | --- | --- | --- |
| api:BuildShoreMap.RunCommandline/0 | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| api:ETerrainNoiseType | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:ETerrainNoiseType.PERLIN | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:ETerrainNoiseType.RANDOM | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_Base.AddComponent/5 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_Base.EOnCreate/8 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_Base.EOnDelete/3 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_Base.EOnMove/4 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_Base.EditablePrefabsComponent_Base/0 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_Base.GetClassName/0 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_EditableEntity.AddBudgetCostsFromEntities/2 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_EditableEntity.AddBudgetCostsFromEntity/2 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_EditableEntity.CreatePreviewImage/6 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_EditableEntity.DeletePreviewImage/2 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_EditableEntity.EOnCreate/8 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_EditableEntity.EOnDelete/3 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_EditableEntity.EOnMove/4 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_EditableEntity.EditablePrefabsComponent_EditableEntity/0 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_EditableEntity.GetEntityBudgetCostsFromGroup/2 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_EditableEntity.GetEntityBudgetCostsFromLinkComponent/3 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_EditableEntity.GetEntityBudgetCostsFromVehicle/4 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_EditableEntity.GetEntityChildrenBudgetCostsFromSource/2 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_EditableEntity.GetImagePath/2 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_EditableEntity.GetLabelsFromSource/9 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_EditableEntity.MovePreviewImage/3 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_EditableEntity.PreserveBudgets/4 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_EditableEntity.ReadEditableEntityComponent/3 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_EditableEntity.SetBudgets/7 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_EditableEntity.SetEntityFlags/7 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_EditableEntity.SetUIInfo/8 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsComponent_PreviewEntity.EOnCreate/8 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.BackupFile/2 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.CompareBackup/2 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.CreateDirectoryFor/2 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.CreateEditablePrefab/4 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.CreateWorld/0 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.DeleteEditablePrefab/2 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.DisableComponent/4 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.EditablePrefabsConfig/0 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.GetConfig/1 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.GetLinkFromSource/2 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.GetLinkFromTarget/2 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.GetLinks/1 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.GetPrefix/0 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.GetResourceNameLink/1 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.GetSettings/1 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.GetSourcePath/0 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.GetSourcePrefab/1 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.GetTargetPath/0 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.GetTargetPathAuto/0 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.IsBlacklisted/1 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.IsEditableEntity/1 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.IsValid/0 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.LogResults/1 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.MoveEditablePrefab/3 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.MoveFile/2 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.UpdateChildPrefabs/6 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.UpdateEditablePrefab/2 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsConfig.VerifyEditablePrefab/3 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsLabel_Base.GetLabelValid/7 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsLabel_CharacterRole.AddLabelForWeaponType/1 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsLabel_CharacterRole.CheckInventory/1 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsLabel_CharacterRole.CheckLoadout/1 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsLabel_CharacterRole.CheckWeaponAttachments/1 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsLabel_CharacterRole.CheckWeapons/1 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsLabel_CharacterRole.GetLabelValid/7 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsLabel_CharacterRole.GetRoleLabel/1 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsLabel_CompositionType.GetLabelValid/7 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsLabel_EntityType.GetLabelValid/7 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsLabel_Faction.GetLabelValid/7 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsLabel_GroupSize.GetLabelValid/7 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsLabel_Size.ContainsSizeLabel/2 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsLabel_Size.ContainsSlotSizeLabel/2 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsLabel_Size.GetEntitySourceBounds/4 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsLabel_Size.GetFileName/1 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsLabel_Size.GetLabelValid/7 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsLabel_Theme.GetLabelValid/7 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsLabel_Trait.GetLabelValid/7 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsLabel_VehicleType.GetLabelValid/7 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsSetting.AddComponents/7 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsSetting.Delete/3 | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| api:EditablePrefabsSetting.GetTarget/0 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:EditablePrefabsSetting.Move/4 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:FilterMorphLerpFunc | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:FilterMorphLerpFunc.INV_COS | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:FilterMorphLerpFunc.INV_SPHERE | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:FilterMorphLerpFunc.LINEAR | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:FilterMorphLerpFunc.SIN | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:FilterMorphLerpFunc.SMOOTH | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:FilterMorphLerpFunc.SPHERE | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:FilterMorphOperation | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:FilterMorphOperation.ADD | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:FilterMorphOperation.COMBINE | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:FilterMorphOperation.EXACT | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:FilterMorphOperation.NOISE | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:FilterMorphOperation.NONCUMULATIVE | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:FilterMorphOperation.SMOOTH | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:FilterMorphShape | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:FilterMorphShape.ROUND | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:FilterMorphShape.SQUARE | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:FilterMorphShape.USER | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:GenerateFlowMaps.RunCommandline/0 | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| api:GeoAttribCollection.Count/0 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoAttribCollection.GeoAttribCollection/0 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoAttribCollection.GetFloat/1 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoAttribCollection.GetFloatByName/1 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoAttribCollection.GetIndexByName/1 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoAttribCollection.GetInt/1 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoAttribCollection.GetIntByName/1 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoAttribCollection.GetName/1 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoAttribCollection.GetString/1 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoAttribCollection.GetStringByName/1 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoAttribCollection.GetType/1 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoAttribCollection.HasAttrib/1 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoAttribCollection.IsAttribSet/1 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoAttribCollection.IsAttribSetByName/1 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoMultiPoint.GetPoints/0 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoPoint.GetCoords/0 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoPolygon.GetPart/1 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoPolygon.PartsCount/0 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoPolyline.GetVertices/0 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoShape.GeoShape/0 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoShape.GetAttributes/0 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoShape.GetType/0 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoShapeCollection.Count/0 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoShapeCollection.Get/1 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoShapeLoader.GeoShapeLoader/0 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoShapeLoader.LoadShapeFile/1 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoShapeLoader.~GeoShapeLoader/0 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoVertexCollection.Count/0 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoVertexCollection.GeoVertexCollection/0 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:GeoVertexCollection.Get/1 | subsumed-by | subsumed-by wb_shape.import (the TS shapefile reader replaces the engine reader, DEC-069 OD-7; P-W6-12 cross-checks) (proposal docs/v2/inbox/w8/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_shape.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| api:ResourceTestPlugin.MakeScreenshotMetafile/2 | subsumed-by | subsumed-by plugin:ResourceTestPlugin (CLI route, blocked:P-W6-08) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:ResourceTestPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResourceTestPlugin.MakeSummeryFile/1 | subsumed-by | subsumed-by plugin:ResourceTestPlugin (CLI route, blocked:P-W6-08) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:ResourceTestPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResourceTestPlugin.OpenResource/3 | subsumed-by | subsumed-by plugin:ResourceTestPlugin (CLI route, blocked:P-W6-08) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:ResourceTestPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResourceTestPlugin.RunCommandline/0 | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| api:SCR_EditableEntityMaintenancePlugin.Run/0 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_UpdateAllEditablePrefabsPlugin.DeleteEmptyDirectories/1 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_UpdateAllEditablePrefabsPlugin.DeleteEmptyDirectoriesCallback/2 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_UpdateAllEditablePrefabsPlugin.Run/0 | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (a modal plugin: GUI path, OD-4) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:TerrainToolDesc | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:TerrainToolDesc_HeightAdd | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:TerrainToolDesc_HeightExact | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:TerrainToolDesc_HeightNoise | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:TerrainToolDesc_HeightSmooth | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:TerrainToolDesc_HeightUser | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:TerrainToolDesc_LayerAdd | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:TerrainToolType | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:TerrainToolType.COUNT | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:TerrainToolType.HEIGHT_ADD | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:TerrainToolType.HEIGHT_EXACT | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:TerrainToolType.HEIGHT_NOISE | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:TerrainToolType.HEIGHT_SMOOTH | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:TerrainToolType.HOLES_ADD_REMOVE | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:TerrainToolType.HOLES_BLOCK_ENABLE_DISABLE | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:TerrainToolType.NONE | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:TerrainToolType.SURFACE_PAINT | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:UserShapeFilter | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:UserShapeFilter.BICUBIC | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:UserShapeFilter.BILINEAR | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:UserShapeFilter.NEAREST | absent-in-build | absent-in-build (last seen 1.8.0.13; 1.9.0.37 has no ModifyHeightMap, ModifyLayers, TerrainToolDesc, TerrainToolType or FilterMorph types; sculpt, flatten, smooth and noise are computed by wb_terrain_edit and written with SetTerrainSurfaceTile) (proposal docs/v2/inbox/w7/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:Workbench.Exit/1 | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| api:Workbench.RunCmd/2 | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| api:Workbench.RunProcess/1 | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| api:Workbench.Workbench/0 | subsumed-by | subsumed-by api:Workbench (private constructor of a static class) (proposal docs/v2/inbox/w8/remainder.jsonl; api:Workbench at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:Workbench.~Workbench/0 | subsumed-by | subsumed-by api:Workbench (private constructor of a static class) (proposal docs/v2/inbox/w8/remainder.jsonl; api:Workbench at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorkbenchPlugin.RunCommandline/0 | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| api:WorkbenchPlugin.WorkbenchPlugin/0 | subsumed-by | subsumed-by api:WorkbenchPlugin (constructor) (proposal docs/v2/inbox/w8/remainder.jsonl; api:WorkbenchPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorkbenchPlugin.~WorkbenchPlugin/0 | subsumed-by | subsumed-by api:WorkbenchPlugin (constructor) (proposal docs/v2/inbox/w8/remainder.jsonl; api:WorkbenchPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldTestPlugin.RunCommandline/0 | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| api:WorldTestPlugin.TestMap/2 | subsumed-by | subsumed-by plugin:WorldTestPlugin (CLI route, blocked:P-W6-08) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:WorldTestPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:WorldTestPlugin.WaitForGameMode/2 | subsumed-by | subsumed-by plugin:WorldTestPlugin (CLI route, blocked:P-W6-08) (proposal docs/v2/inbox/w8/remainder.jsonl; plugin:WorldTestPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:BuildShoreMap | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| plugin:GenerateFlowMaps | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| plugin:ResourceTestPlugin | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| plugin:ResourceTestPlugin#cli:-autotest-output-dir | blocked | blocked:P-W6-08 until the headless run passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:ResourceTestPlugin#cli:-resources | blocked | blocked:P-W6-08 until the headless run passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:SCR_UpdateAllEditablePrefabsPlugin | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| plugin:SCR_UpdateAllEditablePrefabsPlugin#button:ButtonClose | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (dialog button) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SCR_UpdateAllEditablePrefabsPlugin#button:ButtonRun | subsumed-by | subsumed-by plugin:SCR_UpdateAllEditablePrefabsPlugin (dialog button) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:WorldDataExport | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| plugin:WorldDataExport#cli:-excludehills | blocked | blocked:P-W6-08 until the headless run passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:WorldDataExport#cli:-savedir | blocked | blocked:P-W6-08 until the headless run passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:WorldDataExport#cli:-type | blocked | blocked:P-W6-08 until the headless run passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:WorldDataExport#cli:-world | blocked | blocked:P-W6-08 until the headless run passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:WorldTestPlugin | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| plugin:WorldTestPlugin#cli:-wait | blocked | blocked:P-W6-08 until the headless run passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:WorldTestPlugin#cli:-world | blocked | blocked:P-W6-08 until the headless run passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| ui:Shared/shortcut/Common/Reset Default Layouts | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
