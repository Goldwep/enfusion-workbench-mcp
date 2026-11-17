# Census: ResourceManager

3492 rows (49 aggregate excluded).

## What it is

Module ResourceManager: api 536, cli 33, file 9, link 2, mcp 22, net 119, plugin 245, schema 1928, setting 78, ui 520. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- class AddonBuildInfoTool (api:AddonBuildInfoTool)
- class BakeMLODPlugin (api:BakeMLODPlugin)
- class BatchTextureProcessorPlugin (api:BatchTextureProcessorPlugin)
- class EBTConfigPlugin (api:EBTConfigPlugin)
- class NewMlodBakerPlugin (api:NewMlodBakerPlugin)
- class ResaveMetaPlugin (api:ResaveMetaPlugin)
- class ResavePlugin (api:ResavePlugin)
- class ResourceImportPlugin (api:ResourceImportPlugin)
- class ResourceManager (api:ResourceManager)
- class ResourceManagerPlugin (api:ResourceManagerPlugin): Import pipeline hooks: OnRegisterResource, OnBuildResource, OnRenameResource, OnGetMaterialGenerateDir, OnGetMaterialClassName, OnMaterialCreated
- class ResourceProcessorPlugin (api:ResourceProcessorPlugin)
- class SCR_BIKIBulletHelper (api:SCR_BIKIBulletHelper)
- ... 157 more

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| api | 47 | 6 | 477 | 1 | 0 | 5 | 536 |
| cli | 11 | 1 | 21 | 0 | 0 | 0 | 33 |
| file | 6 | 0 | 3 | 0 | 0 | 0 | 9 |
| link | 0 | 1 | 1 | 0 | 0 | 0 | 2 |
| mcp | 2 | 0 | 2 | 12 | 0 | 6 | 22 |
| net | 0 | 9 | 110 | 0 | 0 | 0 | 119 |
| plugin | 38 | 4 | 203 | 0 | 0 | 0 | 245 |
| schema | 34 | 0 | 1894 | 0 | 0 | 0 | 1928 |
| setting | 78 | 0 | 0 | 0 | 0 | 0 | 78 |
| ui | 138 | 174 | 203 | 2 | 0 | 3 | 520 |

## By kind

- attribute: 12
- canvas-gesture: 3
- class: 74
- cli-switch: 33
- context-item: 47
- context-menu: 27
- control: 81
- dialog: 4
- dock: 3
- enum: 4
- enum-value: 16
- event: 6
- file-type: 9
- handler-action: 11
- link-format: 2
- mcp-action: 9
- mcp-tool: 2
- menu: 54
- menu-item: 121
- method: 301
- module: 1
- net-field: 103
- net-handler: 16
- option: 43
- panel: 17
- plugin: 86
- plugin-button: 58
- plugin-cli-arg: 11
- plugin-setting: 90
- property: 34
- property-group: 9
- region: 23
- schema-class: 64
- schema-key: 1830
- setting-key: 78
- shortcut: 70
- static-method: 123
- status-item: 3
- tab: 10
- toolbar-button: 3
- window: 1

## By risk

- credential: 7
- destructive: 26
- external: 30
- mutating: 980
- safe: 2449

## Rows by kind

### attribute (12)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:SCR_DataToSpreadsheetTemplates#attr:m_aAttributesArray | T2/T2 | candidate: net-api-handler | none |
| api:SCR_DataToSpreadsheetTemplates#attr:m_aPrefabsArray | T2/T2 | candidate: net-api-handler | none |
| api:SCR_DataToSpreadsheetTemplatesAttribute#attr:m_eAttributeType | T2/T2 | candidate: net-api-handler | none |
| api:SCR_DataToSpreadsheetTemplatesAttribute#attr:m_sAttributeName | T2/T2 | candidate: net-api-handler | none |
| api:SCR_DataToSpreadsheetTemplatesComponent#attr:m_aAttributesArray | T2/T2 | candidate: net-api-handler | none |
| api:SCR_DataToSpreadsheetTemplatesComponent#attr:m_sComponentName | T2/T2 | candidate: net-api-handler | none |
| api:SCR_DataToSpreadsheetTemplatesObject#attr:m_aAttributesArray | T2/T2 | candidate: net-api-handler | none |
| api:SCR_DataToSpreadsheetTemplatesObject#attr:m_sObjectName | T2/T2 | candidate: net-api-handler | none |
| api:SCR_DataToSpreadsheetTemplatesObjectArray#attr:m_AttributesArray | T2/T2 | candidate: net-api-handler | none |
| api:SCR_DataToSpreadsheetTemplatesObjectArray#attr:m_ObjectName | T2/T2 | candidate: net-api-handler | none |
| api:SCR_DataToSpreadsheetTemplatesObjectIndex#attr:m_aAttributesArray | T2/T2 | candidate: net-api-handler | none |
| api:SCR_DataToSpreadsheetTemplatesObjectIndex#attr:m_iObjectIndex | T2/T2 | candidate: net-api-handler | none |

### canvas-gesture (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager/canvas-gesture/Drag config object into browser | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/canvas-gesture/Drag file onto a property | T0/T2 | candidate: gui-automation, net-api-handler | none |
| ui:ResourceManager/canvas-gesture/Property grid: reset to default | T0/T2 | candidate: net-api-handler | none |

### class (74)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:AddonBuildInfoTool | T2/T2 | candidate: none-known | none |
| api:BakeMLODPlugin | T2/T2 | candidate: none-known | none |
| api:BatchTextureProcessorPlugin | T2/T2 | candidate: none-known | none |
| api:EBTConfigPlugin | T2/T2 | candidate: none-known | none |
| api:NewMlodBakerPlugin | T2/T2 | candidate: none-known | none |
| api:ResaveMetaPlugin | T2/T2 | candidate: none-known | none |
| api:ResavePlugin | T2/T2 | candidate: none-known | none |
| api:ResourceImportPlugin | T2/T2 | candidate: none-known | none |
| api:ResourceManager | T2/T2 | candidate: none-known | none |
| api:ResourceManagerPlugin | T2/T2 | candidate: none-known | none |
| api:ResourceProcessorPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_BIKIBulletHelper | T2/T2 | candidate: none-known | none |
| api:SCR_BIKIExportBasePlugin | T2/T2 | candidate: none-known | none |
| api:SCR_BIKIExportTerrainStatisticsPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_BIKIExportTerrainStatisticsPlugin_LoadProcessCancel | T2/T2 | candidate: none-known | none |
| api:SCR_BIKIFactionAssetsExportPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_BIKIGearHelper | T2/T2 | candidate: none-known | none |
| api:SCR_BIKIGeneralHelper | T2/T2 | candidate: none-known | none |
| api:SCR_BIKIMagazineHelper | T2/T2 | candidate: none-known | none |
| api:SCR_BIKIStringBuilder | T2/T2 | candidate: none-known | none |
| api:SCR_BIKIVehicleHelper | T2/T2 | candidate: none-known | none |
| api:SCR_BIKIWeaponHelper | T2/T2 | candidate: none-known | none |
| api:SCR_BookmarkPlugin0 | T2/T2 | candidate: none-known | none |
| api:SCR_BookmarkPlugin1 | T2/T2 | candidate: none-known | none |
| api:SCR_BookmarkPlugin2 | T2/T2 | candidate: none-known | none |
| api:SCR_BookmarkPlugin3 | T2/T2 | candidate: none-known | none |
| api:SCR_BookmarkPlugin4 | T2/T2 | candidate: none-known | none |
| api:SCR_BookmarkPlugin5 | T2/T2 | candidate: none-known | none |
| api:SCR_BookmarkPlugin6 | T2/T2 | candidate: none-known | none |
| api:SCR_BookmarkPlugin7 | T2/T2 | candidate: none-known | none |
| api:SCR_BookmarkPlugin8 | T2/T2 | candidate: none-known | none |
| api:SCR_BookmarkPlugin9 | T2/T2 | candidate: none-known | none |
| api:SCR_BookmarkPluginPrompt | T2/T2 | candidate: none-known | none |
| api:SCR_BookmarkSettingsPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_CheckRuinModelsAndUsagePlugin | T2/T2 | candidate: none-known | none |
| api:SCR_CreateEditablePrefabsPluginResourceManager | T2/T2 | candidate: none-known | none |
| api:SCR_DataToSpreadsheetElement | T2/T2 | candidate: none-known | none |
| api:SCR_DataToSpreadsheetPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_DataToSpreadsheetTemplates | T2/T2 | candidate: none-known | none |
| api:SCR_DataToSpreadsheetTemplatesAttribute | T2/T2 | candidate: none-known | none |

34 more: wb_census find with module=ResourceManager kind=class.

### cli-switch (33)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| cli:-builddata | T2/T5 | candidate: cli | [mod.build](../tools/mod.md) drive, [wb_build_data.poll](../tools/wb_build_data.md) read, [wb_build_data.run](../tools/wb_build_data.md) drive, [wb_build_data.start](../tools/wb_build_data.md) drive |
| cli:-excludetypes | T2/T5 | candidate: cli | none |
| cli:-filterpath | T2/T5 | candidate: cli | [mod.build](../tools/mod.md) drive |
| cli:-filtertags | T2/T5 | candidate: cli | none |
| cli:-imagesetbuild | T2/T5 | candidate: cli | none |
| cli:-imagesettexture | T2/T5 | candidate: cli | none |
| cli:-includetypes | T2/T5 | candidate: cli | none |
| cli:-loadbuiltdata | T2/T5 | candidate: cli | none |
| cli:-metafiles | T2/T5 | candidate: cli | none |
| cli:-packaddon | T2/T5 | candidate: cli | [wb_cli_run.packAddon](../tools/wb_cli_run.md) drive |
| cli:-packaddoncachedir | T2/T5 | candidate: cli | none |
| cli:-packaddondir | T2/T5 | candidate: cli | none |
| cli:-publishaddon | T2/T2 | candidate: cli | [wb_cli_run.publishAddon](../tools/wb_cli_run.md) drive |
| cli:-publishaddoncachedir | T2/T2 | candidate: cli | none |
| cli:-publishaddonchangenote | T2/T2 | candidate: cli | none |
| cli:-publishaddonchangenotefile | T2/T2 | candidate: cli | none |
| cli:-publishaddondir | T2/T2 | candidate: cli | none |
| cli:-publishaddonpreviewimage | T2/T2 | candidate: cli | none |
| cli:-publishaddonscreenshots | T2/T2 | candidate: cli | none |
| cli:-publishaddonversion | T2/T2 | candidate: cli | none |
| cli:-resavedata | T2/T5 | candidate: cli | none |
| cli:-wbbackendlogin | T1/T2 | candidate: cli | none |
| cli:cli-switch/Backend login | T0/T2 | candidate: cli | none |
| cli:cli-switch/Build data | T0/T5 | candidate: cli | none |
| cli:cli-switch/Build option: -filterPath | T0/T5 | candidate: cli | none |
| cli:cli-switch/Build option: -loadBuiltData | T0/T5 | candidate: cli | none |
| cli:cli-switch/Build option: -metaFiles | T0/T5 | candidate: cli | none |
| cli:cli-switch/Pack addon | T0/T5 | candidate: cli | none |
| cli:cli-switch/Plugin from CLI | T0/T5 | candidate: cli | none |
| cli:cli-switch/Publish addon (update only) | T0/T2 | candidate: cli | none |
| cli:cli-switch/Resave data | T0/T5 | candidate: cli | none |
| cli:cli-switch/Script authorisation | T0/T5 | candidate: cli | none |
| cli:cli-switch/Settings control | T0/T5 | candidate: cli | none |

### context-item (47)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager/context-item/File view/Copy File Path(s) | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Copy Link | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Copy Resource GUID(s) | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Copy Resource Name(s) | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Delete | T1/T2 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Duplicate to... | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Edit Prefab(s) | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Find References | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Inherit in... | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Navigate to Ancestor | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Navigate to Folder | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Navigate to Original | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Navigate to Override | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Open File in New Tab | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Override in... | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Refresh Thumbnail(s) | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Register | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Register and Import | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Reimport | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Rename | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Revert changes | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/SVN/Add | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/SVN/Commit | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/SVN/Remove | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/SVN/Revert | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/SVN/Update | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Save changes | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Show in Explorer | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/File view/Transfer to... | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/Tabs/Close All But This | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/Tabs/Close All Tabs | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/Tabs/Close Tab | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/Tabs/Navigate to File | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/Tabs/Reopen Closed Tabs | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/Tabs/Show in Explorer | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/Tree view/Copy Resource GUID(s) | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/Tree view/Copy Resource Name(s) | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/Tree view/Delete | T1/T2 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/Tree view/Edit Properties | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/context-item/Tree view/Register | T1/T5 | candidate: execute-action, gui-automation | none |

7 more: wb_census find with module=ResourceManager kind=context-item.

### context-menu (27)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager/context-menu/Context: Copy File Path(s) | T0/T3 | candidate: net-api-handler | none |
| ui:ResourceManager/context-menu/Context: Copy Link | T0/T3 | candidate: file-format | none |
| ui:ResourceManager/context-menu/Context: Copy Resource GUID(s) | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:ResourceManager/context-menu/Context: Copy Resource Name(s) | T0/T3 | candidate: net-api-handler | none |
| ui:ResourceManager/context-menu/Context: Delete | T0/T3 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/context-menu/Context: Rename | T0/T3 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/context-menu/File context: Duplicate to <addon> | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager/context-menu/File context: Edit Prefab(s) | T0/T3 | candidate: gui-automation, plugin-run | none |
| ui:ResourceManager/context-menu/File context: Find References | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager/context-menu/File context: Navigate to Folder | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager/context-menu/File context: Open File in New Tab | T0/T3 | candidate: net-api-handler | none |
| ui:ResourceManager/context-menu/File context: Override in <addon> | T0/T3 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/context-menu/File context: Plugins/(context plugins) | T0/T3 | candidate: plugin-run | none |
| ui:ResourceManager/context-menu/File context: Refresh Thumbnail(s) | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager/context-menu/File context: Register | T0/T3 | candidate: net-api-handler | none |
| ui:ResourceManager/context-menu/File context: Register and Import | T0/T3 | candidate: net-api-handler | none |
| ui:ResourceManager/context-menu/File context: Reimport | T0/T3 | candidate: net-api-handler | none |
| ui:ResourceManager/context-menu/File context: Transfer to <addon> | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager/context-menu/File view | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/context-menu/File view/SVN | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/context-menu/Property grid: Copy property path | T0/T3 | candidate: net-api-handler | none |
| ui:ResourceManager/context-menu/Tabs | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/context-menu/Tree context: Edit Properties (folder) | T0/T3 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/context-menu/Tree context: Register (folder) | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager/context-menu/Tree context: Show in Explorer | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager/context-menu/Tree view | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/context-menu/Tree view/SVN | T1/T3 | candidate: gui-automation | none |

### control (81)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager/control/#Maximize-Restore | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/#Minimize-Restore | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/#ScriptConsole | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/#filterButton | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/#navigateBackward | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/#navigateForward | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/#navigateUp | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/Close | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/Filter by Category | T0/T5 | candidate: net-api-handler | none |
| ui:ResourceManager/control/Filter: Show Runtime files only | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/Filter: Show unregistered sources only | T0/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/control/Game Project: project selector + image Set%2FClear | T0/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/control/Import Settings/Edit also selected files | T1/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/Import Settings: Apply changes to all platforms | T0/T5 | candidate: net-api-handler | none |
| ui:ResourceManager/control/Import Settings: Edit also selected files | T0/T5 | candidate: net-api-handler | none |
| ui:ResourceManager/control/LINKS/@QListWidget.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/LINKS/@QListWidget.1/@ListItem.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/LINKS/@QListWidget.1/@ListItem.2 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/LINKS/@QListWidget.1/@ListItem.3 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/LINKS/@QListWidget.1/@ListItem.4 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/LINKS/@QListWidget.1/@ListItem.5 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/LINKS/@QListWidget.1/@ListItem.6 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/LINKS/@QListWidget.1/@ListItem.7 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/Login/Create Account | T1/T2 | candidate: gui-automation | none |
| ui:ResourceManager/control/Login/Forgot Password? | T1/T2 | candidate: gui-automation | none |
| ui:ResourceManager/control/Login/Login | T1/T2 | candidate: gui-automation | none |
| ui:ResourceManager/control/Login/email | T1/T2 | candidate: gui-automation | none |
| ui:ResourceManager/control/Login/password | T1/T2 | candidate: gui-automation | none |
| ui:ResourceManager/control/NEWS/@QListWidget.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/NEWS/@QListWidget.1/@ListItem.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/NEWS/@QListWidget.1/@ListItem.2 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/NEWS/@QListWidget.1/@ListItem.3 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/Option: Expand All on Search | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/Option: Icons Scale | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager/control/Publish Project/Category | T1/T2 | candidate: gui-automation | none |
| ui:ResourceManager/control/Publish Project/Change Notes | T1/T2 | candidate: gui-automation | none |
| ui:ResourceManager/control/Publish Project/Contributors | T1/T2 | candidate: gui-automation | none |
| ui:ResourceManager/control/Publish Project/Description | T1/T2 | candidate: gui-automation | none |
| ui:ResourceManager/control/Publish Project/License | T1/T2 | candidate: gui-automation | none |
| ui:ResourceManager/control/Publish Project/Preview Image | T1/T2 | candidate: gui-automation | none |

41 more: wb_census find with module=ResourceManager kind=control.

### dialog (4)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager/dialog/FBX register dialog | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager/dialog/Login | T1/T2 | candidate: gui-automation | none |
| ui:ResourceManager/dialog/Options | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/dialog/Publish Project | T1/T2 | candidate: gui-automation | none |

### dock (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager/dock/#consoleDock | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/dock/#resourceBrowserDock | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/dock/#resourceBrowserDock2 | T0/T3 | candidate: gui-automation | none |

### enum (4)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:SCR_EDataToSpreadsheetDataType | T2/T2 | candidate: none-known | none |
| api:SCR_EGenerateControlsSchemeType | T2/T2 | candidate: none-known | none |
| api:SCR_ESearchXOBPluginLayerFilter | T2/T2 | candidate: none-known | none |
| api:SCR_ESearchXOBPluginSearchType | T2/T2 | candidate: none-known | none |

### enum-value (16)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:SCR_EDataToSpreadsheetDataType.FLOAT | T2/T2 | candidate: none-known | none |
| api:SCR_EDataToSpreadsheetDataType.INT | T2/T2 | candidate: none-known | none |
| api:SCR_EDataToSpreadsheetDataType.RESOURCE | T2/T2 | candidate: none-known | none |
| api:SCR_EDataToSpreadsheetDataType.STRING | T2/T2 | candidate: none-known | none |
| api:SCR_EGenerateControlsSchemeType.GAMEPAD | T2/T2 | candidate: none-known | none |
| api:SCR_EGenerateControlsSchemeType.KEYBOARD | T2/T2 | candidate: none-known | none |
| api:SCR_EGenerateControlsSchemeType.MOUSE | T2/T2 | candidate: none-known | none |
| api:SCR_ESearchXOBPluginLayerFilter.ALL | T2/T2 | candidate: none-known | none |
| api:SCR_ESearchXOBPluginLayerFilter.ANY | T2/T2 | candidate: none-known | none |
| api:SCR_ESearchXOBPluginLayerFilter.EXACT | T2/T2 | candidate: none-known | none |
| api:SCR_ESearchXOBPluginLayerFilter.NONE | T2/T2 | candidate: none-known | none |
| api:SCR_ESearchXOBPluginSearchType.InvalidMask | T2/T2 | candidate: none-known | none |
| api:SCR_ESearchXOBPluginSearchType.LayerMask | T2/T2 | candidate: none-known | none |
| api:SCR_ESearchXOBPluginSearchType.LayerPreset | T2/T2 | candidate: none-known | none |
| api:SCR_ESearchXOBPluginSearchType.ListAllXOBs | T2/T2 | candidate: none-known | none |
| api:SCR_ESearchXOBPluginSearchType.LoadAllXOBs | T2/T2 | candidate: none-known | none |

### event (6)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:ResourceManagerPlugin.OnBuildResource/5 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceManagerPlugin.OnGetMaterialClassName/2 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceManagerPlugin.OnGetMaterialGenerateDir/1 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceManagerPlugin.OnMaterialCreated/3 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceManagerPlugin.OnRegisterResource/2 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceManagerPlugin.OnRenameResource/3 | T2/T5 | candidate: net-api-handler | none |

### file-type (9)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| file:.dlg | T0/T3 | candidate: file-format | none |
| file:.emat | T2/T3 | candidate: file-format | [asset_search.run](../tools/asset_search.md) read, [find_broken_refs.run](../tools/find_broken_refs.md) read, [find_references.run](../tools/find_references.md) read, [find_unused_resources.run](../tools/find_unused_resources.md) read, [inheritance_chain.run](../tools/inheritance_chain.md) read, [list_resources.run](../tools/list_resources.md) read, [material_diff.run](../tools/material_diff.md) read, [material_find_unused_textures.run](../tools/material_find_unused_textures.md) read, [material_inspect.run](../tools/material_inspect.md) read, [project_index_status.run](../tools/project_index_status.md) read, [refactor_remove_unused.run](../tools/refactor_remove_unused.md) read, [resolve_guid.run](../tools/resolve_guid.md) read |
| file:.fbxa | T0/T3 | candidate: file-format | none |
| file:.meta | T2/T3 | candidate: file-format | [meta_file.clear](../tools/meta_file.md) drive, [meta_file.read](../tools/meta_file.md) read, [meta_file.scan](../tools/meta_file.md) drive, [meta_file.set](../tools/meta_file.md) drive, [meta_file.setAncestor](../tools/meta_file.md) drive, [refactor_merge_duplicate_guids.run](../tools/refactor_merge_duplicate_guids.md) read, [refactor_move_resource_path.run](../tools/refactor_move_resource_path.md) read |
| file:.ragdoll | T2/T3 | candidate: file-format | none |
| file:file-type/.adeb (.adbg in the other page) | T0/T3 | candidate: file-format | none |
| file:file-type/.meta file format | T0/T3 | candidate: file-format | none |
| file:file-type/Packed addon layout | T0/T3 | candidate: file-format | none |
| file:file-type/resourceDatabase.rdb | T0/T3 | candidate: cli | none |

### handler-action (11)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| mcp:handler-action/EMCP_WB_Anim.check | T3/T5 | candidate: net-api-handler | [wb_anim.check](../tools/wb_anim.md) drive |
| mcp:handler-action/EMCP_WB_Anim.txaChannels | T3/T5 | candidate: net-api-handler | [wb_anim.txaChannels](../tools/wb_anim.md) read |
| mcp:handler-action/EMCP_WB_Anim.txaEdit | T3/T5 | candidate: net-api-handler | [wb_anim.txaEdit](../tools/wb_anim.md) drive |
| mcp:handler-action/EMCP_WB_Anim.txaExport | T3/T5 | candidate: net-api-handler | [wb_anim.txaExport](../tools/wb_anim.md) drive |
| mcp:handler-action/EMCP_WB_Anim.txaProfiles | T3/T5 | candidate: net-api-handler | [wb_anim.txaProfiles](../tools/wb_anim.md) read |
| mcp:handler-action/EMCP_WB_Anim.txaRead | T3/T5 | candidate: net-api-handler | [wb_anim.txaRead](../tools/wb_anim.md) read |
| mcp:handler-action/EMCP_WB_Resources.browse | T0/T5 | candidate: net-api-handler | none |
| mcp:handler-action/EMCP_WB_Resources.open | T0/T5 | candidate: net-api-handler | [wb_resources.open](../tools/wb_resources.md) read |
| mcp:handler-action/EMCP_WB_Validate.fixTexture | T5/T5 | net-api-handler | [wb_validate.fixTexture](../tools/wb_validate.md) drive, [wb_validate.fixTexture](../tools/wb_validate.md) read |
| mcp:handler-action/EMCP_WB_Validate.material | T5/T5 | net-api-handler | [wb_validate.material](../tools/wb_validate.md) drive, [wb_validate.material](../tools/wb_validate.md) read |
| mcp:handler-action/EMCP_WB_Validate.texture | T5/T5 | net-api-handler | [wb_validate.texture](../tools/wb_validate.md) drive, [wb_validate.texture](../tools/wb_validate.md) read |

### link-format (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| link:enfusion://ResourceManager | T1/T5 | candidate: cli | [wb_link.build](../tools/wb_link.md) read, [wb_link.open](../tools/wb_link.md) drive, [wb_link.parse](../tools/wb_link.md) read |
| link:https://community.bistudio.com/wiki/Arma_Reforger:Resource_Manager | T2/T5 | candidate: file-format | none |

### mcp-action (9)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| mcp:action/wb_anim.check | T3/T5 | candidate: none-known | [wb_anim.check](../tools/wb_anim.md) drive |
| mcp:action/wb_anim.txaChannels | T3/T5 | candidate: none-known | [wb_anim.txaChannels](../tools/wb_anim.md) drive |
| mcp:action/wb_anim.txaEdit | T3/T5 | candidate: none-known | [wb_anim.txaEdit](../tools/wb_anim.md) drive |
| mcp:action/wb_anim.txaExport | T3/T5 | candidate: none-known | [wb_anim.txaExport](../tools/wb_anim.md) drive |
| mcp:action/wb_anim.txaProfiles | T3/T5 | candidate: none-known | [wb_anim.txaProfiles](../tools/wb_anim.md) drive |
| mcp:action/wb_anim.txaRead | T3/T5 | candidate: none-known | [wb_anim.txaRead](../tools/wb_anim.md) drive |
| mcp:action/wb_validate.fixTexture | T5/T5 | net-api-handler | [wb_validate.fixTexture](../tools/wb_validate.md) drive |
| mcp:action/wb_validate.material | T5/T5 | net-api-handler | [wb_validate.material](../tools/wb_validate.md) drive |
| mcp:action/wb_validate.texture | T5/T5 | net-api-handler | [wb_validate.texture](../tools/wb_validate.md) drive |

### mcp-tool (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| mcp:tool/wb_anim | T2/T2 | candidate: none-known | none |
| mcp:tool/wb_validate | T2/T2 | candidate: none-known | none |

### menu (54)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager/menu/Create button | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:ResourceManager/menu/Edit | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Edit/Edit prefab (Ctrl+E) | T0/T3 | candidate: execute-action | none |
| ui:ResourceManager/menu/Edit/Locate file in resource browser (Ctrl+B) | T0/T3 | candidate: execute-action | none |
| ui:ResourceManager/menu/Edit/Reimport resource (F5) | T0/T3 | candidate: execute-action, net-api-handler | none |
| ui:ResourceManager/menu/Editors | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/File | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Help | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Help/About | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Plugins | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Plugins/(plugin entries and category submenus) | T0/T3 | candidate: execute-action, plugin-run | none |
| ui:ResourceManager/menu/Plugins/BIKI | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Plugins/Bookmarks | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Plugins/EBT Validation | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Plugins/In-game Editor | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Plugins/Prefabs | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Plugins/QA | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Plugins/SVN | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Plugins/Settings | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Plugins/Settings/(per-plugin entries) | T0/T3 | candidate: file-format, plugin-run | none |
| ui:ResourceManager/menu/Plugins/Settings/Clear All Settings | T0/T2 | candidate: execute-action | none |
| ui:ResourceManager/menu/Plugins/Settings/List world resources | T0/T3 | candidate: execute-action | none |
| ui:ResourceManager/menu/Plugins/Settings/Material Import | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Plugins/Settings/Reload WB Scripts (Ctrl+Shift+R) | T0/T3 | candidate: execute-action | none |
| ui:ResourceManager/menu/Plugins/Tools | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Plugins/User Settings | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Plugins/Version Control System | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Utilities | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Utilities/File system sources (File system dump) | T0/T3 | candidate: execute-action | none |
| ui:ResourceManager/menu/Utilities/Generate GUID | T0/T3 | candidate: execute-action, net-api-handler | none |
| ui:ResourceManager/menu/Utilities/LSP Tests | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Utilities/LSP Tests/BaseTests | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Utilities/LSP Tests/DidChange | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Utilities/LSP Tests/OpenClose | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Utilities/LSP Tests/SignatureHelp | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Utilities/LSP Tests/TestingFrameworkItself | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Utilities/Qt introspection tool | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Utilities/Resource Tests | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/Utilities/Resource Tests/Texture Tests | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/menu/View | T2/T3 | candidate: gui-automation | none |

14 more: wb_census find with module=ResourceManager kind=menu.

### menu-item (121)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager/menu-item/Edit/Edit Prefab | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Edit/Locate File in Resource Browser | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Edit/Redo | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Edit/Reimport Resource | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Edit/Undo | T3/T5 | candidate: execute-action, gui-automation | [wb_module.action](../tools/wb_module.md) drive |
| ui:ResourceManager/menu-item/Editors/Animation Editor | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Editors/Audio Editor | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Editors/Behavior Editor | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Editors/Particle Editor | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Editors/Procedural Animation Editor | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Editors/Script Editor | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Editors/String Editor | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Editors/World Editor | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/File/@QWidgetAction.1 | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/File/Check Pending Invitations | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/File/Exit | T2/T2 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/File/Options... | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/File/Project Settings... | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/File/Publish to Workshop | T2/T2 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/File/Remove from Workshop | T2/T2 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/File/Save | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/File/Save All | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/File/User Profile | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Help/About | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Help/View Help | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Plugins/BIKI/Export Assets | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Plugins/BIKI/Export Terrain Statistics | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Plugins/Batch resource processor | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Plugins/Batch texture processor | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Plugins/Bookmarks | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Plugins/Bookmarks/Bookmark 1 | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Plugins/Bookmarks/Bookmark 10 | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Plugins/Bookmarks/Bookmark 2 | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Plugins/Bookmarks/Bookmark 3 | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Plugins/Bookmarks/Bookmark 4 | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Plugins/Bookmarks/Bookmark 5 | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Plugins/Bookmarks/Bookmark 6 | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Plugins/Bookmarks/Bookmark 7 | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Plugins/Bookmarks/Bookmark 8 | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager/menu-item/Plugins/Bookmarks/Bookmark 9 | T2/T5 | candidate: execute-action, gui-automation | none |

81 more: wb_census find with module=ResourceManager kind=menu-item.

### method (301)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:AddonBuildInfoTool.GenerateCiInfo/4 | T2/T5 | candidate: net-api-handler | none |
| api:AddonBuildInfoTool.OnEntFileFound/2 | T2/T5 | candidate: net-api-handler | none |
| api:AddonBuildInfoTool.Run/0 | T2/T5 | candidate: net-api-handler | none |
| api:AddonBuildInfoTool.RunCommandline/0 | T2/T2 | candidate: net-api-handler | none |
| api:AddonBuildInfoTool.TryExtractGUID/2 | T2/T5 | candidate: net-api-handler | none |
| api:BakeMLODPlugin.BakeMLODPlugin/0 | T2/T5 | candidate: net-api-handler | none |
| api:BakeMLODPlugin.ButtonOK/0 | T2/T5 | candidate: net-api-handler | none |
| api:BakeMLODPlugin.Configure/0 | T2/T5 | candidate: net-api-handler | none |
| api:BakeMLODPlugin.OnResourceContextMenu/1 | T2/T5 | candidate: net-api-handler | none |
| api:BakeMLODPlugin.StartBake/1 | T2/T5 | candidate: net-api-handler | none |
| api:BakeMLODPlugin.VoidPrint/1 | T2/T5 | candidate: net-api-handler | none |
| api:BatchTextureProcessorPlugin.Cancel/0 | T2/T5 | candidate: net-api-handler | none |
| api:BatchTextureProcessorPlugin.Find/2 | T2/T5 | candidate: net-api-handler | none |
| api:BatchTextureProcessorPlugin.OK/0 | T2/T5 | candidate: net-api-handler | none |
| api:BatchTextureProcessorPlugin.Run/0 | T2/T5 | candidate: net-api-handler | none |
| api:BatchTextureProcessorPlugin.TestAgainstFilter/1 | T2/T5 | candidate: net-api-handler | none |
| api:EBTConfigPlugin.ButtonOK/0 | T2/T5 | candidate: net-api-handler | none |
| api:EBTConfigPlugin.ButtonUpdateDropdownMenu/0 | T1/T5 | candidate: net-api-handler | none |
| api:EBTConfigPlugin.Configure/0 | T2/T5 | candidate: net-api-handler | none |
| api:EBTConfigPlugin.EBTConfigPlugin/0 | T2/T5 | candidate: net-api-handler | none |
| api:NewMlodBakerPlugin.CreateBakeRequest/2 | T2/T5 | candidate: net-api-handler | none |
| api:NewMlodBakerPlugin.GetMlodMaterial/1 | T2/T5 | candidate: net-api-handler | none |
| api:NewMlodBakerPlugin.OnResourceContextMenu/1 | T2/T5 | candidate: net-api-handler | none |
| api:NewMlodBakerPlugin.ValidateXOBResource/1 | T2/T5 | candidate: net-api-handler | none |
| api:ResaveMetaPlugin.Cancel/0 | T2/T5 | candidate: net-api-handler | none |
| api:ResaveMetaPlugin.Find/2 | T2/T5 | candidate: net-api-handler | none |
| api:ResaveMetaPlugin.OK/0 | T2/T5 | candidate: net-api-handler | none |
| api:ResaveMetaPlugin.Resave/0 | T2/T5 | candidate: net-api-handler | none |
| api:ResaveMetaPlugin.Run/0 | T2/T5 | candidate: net-api-handler | none |
| api:ResaveMetaPlugin.RunCommandline/0 | T2/T2 | candidate: net-api-handler | none |
| api:ResavePlugin.Cancel/0 | T2/T5 | candidate: net-api-handler | none |
| api:ResavePlugin.Find/1 | T2/T5 | candidate: net-api-handler | none |
| api:ResavePlugin.OK/0 | T2/T5 | candidate: net-api-handler | none |
| api:ResavePlugin.Resave/0 | T2/T5 | candidate: net-api-handler | none |
| api:ResavePlugin.Run/0 | T2/T5 | candidate: net-api-handler | none |
| api:ResavePlugin.RunCommandline/0 | T2/T2 | candidate: net-api-handler | none |
| api:ResourceImportPlugin.Configure/0 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceImportPlugin.OkButton/0 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceImportPlugin.OnGetMaterialGenerateDir/1 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceImportPlugin.OnRegisterResource/2 | T2/T5 | candidate: net-api-handler | none |

261 more: wb_census find with module=ResourceManager kind=method.

### module (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager/module/ResourceManager | T1/T5 | candidate: builtin-net-handler, net-api-handler | [wb_module.info](../tools/wb_module.md) drive |

### net-field (103)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| net:handler/ExportFBXResource#req:exportMorphs | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportFBXResource#req:exportSceneHierarchy | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportFBXResource#req:exportSkinning | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportFBXResource#req:materialOverrides | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportFBXResource#req:resourcePath | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportFBXResource#req:validationMode | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportFBXResource#resp:message | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportFBXResource#resp:resourcePath | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportFBXResource#resp:status | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportMaterialResource#req:create | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportMaterialResource#req:data | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportMaterialResource#req:resourceName | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportMaterialResource#req:resourcePath | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportMaterialResource#req:type | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportMaterialResource#resp:message | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportMaterialResource#resp:resourcePath | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportMaterialResource#resp:status | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTXAResource#req:DiffData | T1/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTXAResource#req:Fps | T1/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTXAResource#req:KeyData | T1/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTXAResource#req:NumChannels | T1/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTXAResource#req:NumKeyframes | T1/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTXAResource#req:Profile | T1/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTXAResource#req:ProfileDirectory | T1/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTXAResource#req:SourceFile | T1/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTXAResource#req:TargetFile | T1/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTXAResource#req:diffData | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTXAResource#req:fps | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTXAResource#req:keyData | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTXAResource#req:numberOfChannels | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTXAResource#req:numberOfKeyframes | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTXAResource#req:profile | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTXAResource#req:sourceFile | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTXAResource#req:targetFile | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTXAResource#resp:message | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTXAResource#resp:resourcePath | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTXAResource#resp:status | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTextureResource#req:destinationPath | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTextureResource#req:sourcePath | T2/T2 | candidate: builtin-net-handler | none |
| net:handler/ExportTextureResource#resp:message | T2/T2 | candidate: builtin-net-handler | none |

63 more: wb_census find with module=ResourceManager kind=net-field.

### net-handler (16)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| net:handler/ExportFBXResource | T2/T5 | candidate: builtin-net-handler | [wb_bi.describe](../tools/wb_bi.md) read, [wb_bi.list](../tools/wb_bi.md) read |
| net:handler/ExportMaterialResource | T2/T5 | candidate: builtin-net-handler | [wb_bi.describe](../tools/wb_bi.md) read, [wb_bi.list](../tools/wb_bi.md) read |
| net:handler/ExportTXAResource | T2/T5 | candidate: builtin-net-handler | [wb_bi.describe](../tools/wb_bi.md) read, [wb_bi.list](../tools/wb_bi.md) read |
| net:handler/ExportTextureResource | T2/T5 | candidate: builtin-net-handler | [wb_bi.describe](../tools/wb_bi.md) read, [wb_bi.list](../tools/wb_bi.md) read |
| net:handler/GetPortalMat | T2/T5 | candidate: builtin-net-handler | [wb_bi.describe](../tools/wb_bi.md) read, [wb_bi.list](../tools/wb_bi.md) read |
| net:handler/GetPrefabChildInfo | T2/T5 | candidate: builtin-net-handler | [wb_bi.call](../tools/wb_bi.md) read, [wb_bi.describe](../tools/wb_bi.md) read, [wb_bi.list](../tools/wb_bi.md) read |
| net:handler/GetPrefabGUID | T2/T5 | candidate: builtin-net-handler | [wb_bi.call](../tools/wb_bi.md) read, [wb_bi.describe](../tools/wb_bi.md) read, [wb_bi.list](../tools/wb_bi.md) read, [wb_prefabs.getGuid](../tools/wb_prefabs.md) read |
| net:handler/GetRelativePath | T2/T5 | candidate: builtin-net-handler | [wb_bi.call](../tools/wb_bi.md) read, [wb_bi.describe](../tools/wb_bi.md) read, [wb_bi.list](../tools/wb_bi.md) read |
| net:handler/GetResourceInfo | T2/T5 | candidate: builtin-net-handler | [wb_bi.call](../tools/wb_bi.md) read, [wb_bi.describe](../tools/wb_bi.md) read, [wb_bi.list](../tools/wb_bi.md) read, [wb_resources.getInfo](../tools/wb_resources.md) read |
| net:handler/MaterialValidator | T2/T5 | candidate: builtin-net-handler | [wb_bi.describe](../tools/wb_bi.md) read, [wb_bi.list](../tools/wb_bi.md) read, [wb_validate.material](../tools/wb_validate.md) read |
| net:handler/OpenXOB | T2/T5 | candidate: builtin-net-handler | [wb_bi.describe](../tools/wb_bi.md) read, [wb_bi.list](../tools/wb_bi.md) read |
| net:handler/PrefabImporter | T2/T5 | candidate: builtin-net-handler | [wb_bi.call](../tools/wb_bi.md) read, [wb_bi.describe](../tools/wb_bi.md) read, [wb_bi.list](../tools/wb_bi.md) read |
| net:handler/PrefabImporterBake | T2/T5 | candidate: builtin-net-handler | [wb_bi.describe](../tools/wb_bi.md) read, [wb_bi.list](../tools/wb_bi.md) read |
| net:handler/RegisterResource | T2/T5 | candidate: builtin-net-handler | [wb_bi.describe](../tools/wb_bi.md) read, [wb_bi.list](../tools/wb_bi.md) read |
| net:handler/TextureValidation | T2/T5 | candidate: builtin-net-handler | [wb_bi.call](../tools/wb_bi.md) read, [wb_bi.describe](../tools/wb_bi.md) read, [wb_bi.list](../tools/wb_bi.md) read |
| net:handler/TextureValidator | T2/T5 | candidate: builtin-net-handler | [wb_bi.describe](../tools/wb_bi.md) read, [wb_bi.list](../tools/wb_bi.md) read, [wb_validate.texture](../tools/wb_validate.md) read |

### option (43)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager/option/Options/Animation Editor/Event Filter | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/Animation Editor/Node Colors | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/Audio Editor/Default audio listener model | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/Behavior Editor/Restore session | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/Script Editor/Append closing bracket | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/Script Editor/Font Family | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/Script Editor/Font Size | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/Script Editor/Show scroll-bar markers | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/Script Editor/Tab Size | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/Workbench/Auto-rebuild scripts | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/Workbench/Enable net API | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/Workbench/Export settings | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/Workbench/FPS limit | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/Workbench/Invert mouse | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/Workbench/Qt Style Sheet | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/Workbench/Register "enfusion:%2F%2F" protocol | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/Workbench/Use SVN integration | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/World Editor/Compass/Show axis | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/World Editor/Compass/Show compass | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/World Editor/Entity Selection/Outline Enabled | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/World Editor/Entity Selection/Outline Intersection Opacity | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/World Editor/Entity Selection/Outline Mask enabled | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/World Editor/Entity Selection/Outline Mask opacity | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/World Editor/Entity Selection/Outline Thickness | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Options/World Editor/General/Undo Steps | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Resource Browser/Filters/Filter by Category | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Resource Browser/Filters/Show Runtime files only | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Resource Browser/Filters/Show unregistered sources only | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Resource Browser/Options/Always Off | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Resource Browser/Options/Always On | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Resource Browser/Options/Ascending sorting order | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Resource Browser/Options/Descending sorting order | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Resource Browser/Options/Expand All on Search | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Resource Browser/Options/Grid View | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Resource Browser/Options/Horizontal Layout | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Resource Browser/Options/Icons Scale | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Resource Browser/Options/List View | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Resource Browser/Options/On with filters | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Resource Browser/Options/Sort by Date | T1/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager/option/Resource Browser/Options/Sort by Name | T1/T5 | candidate: file-format, gui-automation | none |

3 more: wb_census find with module=ResourceManager kind=option.

### panel (17)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager/panel/#consoleDockContents | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager/panel/#resourceBrowserDockContents | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager/panel/#statusbar | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager/panel/Details tab | T0/T3 | candidate: gui-automation, net-api-handler | none |
| ui:ResourceManager/panel/Directory tree + file pane | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:ResourceManager/panel/Favorites | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager/panel/Import Settings tab | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:ResourceManager/panel/LINKS | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/panel/Log Console | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/panel/Log Console: level filters | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager/panel/Main Window | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/panel/NEWS | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/panel/QUICK LAUNCH | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager/panel/RM script console | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager/panel/Resource Browser | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/panel/Status bar: version + backend | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager/panel/Welcome tab | T0/T3 | candidate: file-format | none |

### plugin (86)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:AddonBuildInfoTool | T2/T2 | candidate: plugin-run | none |
| plugin:BakeMLODPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:BatchTextureProcessorPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:EBTConfigPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:NewMlodBakerPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:ResaveMetaPlugin | T2/T2 | candidate: plugin-run | none |
| plugin:ResavePlugin | T2/T2 | candidate: plugin-run | none |
| plugin:ResourceImportPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:ResourceProcessorPlugin | T2/T2 | candidate: plugin-run | none |
| plugin:SCR_AutotestConfigValidationPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BIKIFactionAssetsExportPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkPlugin0 | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkPlugin1 | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkPlugin2 | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkPlugin3 | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkPlugin4 | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkPlugin5 | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkPlugin6 | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkPlugin7 | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkPlugin8 | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkPlugin9 | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkSettingsPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_CheckRuinModelsAndUsagePlugin | T2/T5 | candidate: plugin-run | [wb_plugin.run](../tools/wb_plugin.md) drive |
| plugin:SCR_CreateEditablePrefabsPluginResourceManager | T2/T2 | candidate: plugin-run | none |
| plugin:SCR_DataToSpreadsheetPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_FindResourcesPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_GenerateControlsSchemePlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_GenerateLayoutClassPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ImageSetGenerator | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_LocParserPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_MultiPhaseDestructionSoundlessPrefabSearchPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_PrefabEditingPluginResourceManager | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_PrefabTemplateClassCheckPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_PrefabValidatorPlugin | T2/T2 | candidate: plugin-run | none |
| plugin:SCR_ReforgerEngineSettingsPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ReforgerGameSettingsPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_RegisterPlaceableEntitiesPlugin | T2/T2 | candidate: plugin-run | none |
| plugin:SCR_SocketSpawnerPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_VCSBlameResourceManagerPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_VCSCommitResourceManagerPlugin | T2/T5 | candidate: plugin-run | none |

46 more: wb_census find with module=ResourceManager kind=plugin.

### plugin-button (58)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:BakeMLODPlugin#button:ButtonOK | T2/T5 | candidate: plugin-run | none |
| plugin:BatchTextureProcessorPlugin#button:Cancel | T2/T5 | candidate: plugin-run | none |
| plugin:BatchTextureProcessorPlugin#button:OK | T2/T5 | candidate: plugin-run | none |
| plugin:EBTConfigPlugin#button:ButtonOK | T2/T5 | candidate: plugin-run | none |
| plugin:EBTConfigPlugin#button:ButtonUpdateDropdownMenu | T1/T5 | candidate: plugin-run | none |
| plugin:ResaveMetaPlugin#button:Cancel | T2/T5 | candidate: plugin-run | none |
| plugin:ResaveMetaPlugin#button:OK | T2/T5 | candidate: plugin-run | none |
| plugin:ResavePlugin#button:Cancel | T2/T5 | candidate: plugin-run | none |
| plugin:ResavePlugin#button:OK | T2/T5 | candidate: plugin-run | none |
| plugin:ResourceImportPlugin#button:OkButton | T2/T5 | candidate: plugin-run | none |
| plugin:ResourceProcessorPlugin#button:Cancel | T2/T5 | candidate: plugin-run | none |
| plugin:ResourceProcessorPlugin#button:OK | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BIKIFactionAssetsExportPlugin#button:ButtonCancel | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BIKIFactionAssetsExportPlugin#button:ButtonOK | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkPlugin0#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkPlugin1#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkPlugin2#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkPlugin3#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkPlugin4#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkPlugin5#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkPlugin6#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkPlugin7#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkPlugin8#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkPlugin9#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkSettingsPlugin#button:ButtonCancel | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BookmarkSettingsPlugin#button:ButtonSave | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_CheckRuinModelsAndUsagePlugin#button:CloseButton | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_CreateEditablePrefabsPluginResourceManager#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DataToSpreadsheetPlugin#button:CancelButton | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DataToSpreadsheetPlugin#button:ExportButton | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DataToSpreadsheetPlugin#button:ImportButton | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_FindResourcesPlugin#button:Cancel | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_FindResourcesPlugin#button:OK | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_GenerateControlsSchemePlugin#button:ButtonCancel | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_GenerateControlsSchemePlugin#button:ButtonOK | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_GenerateLayoutClassPlugin#button:ButtonCancel | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_GenerateLayoutClassPlugin#button:ButtonOK | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ImageSetGenerator#button:ButtonCancel | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ImageSetGenerator#button:ButtonOK | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_LocParserPlugin#button:ButtonCancel | T2/T5 | candidate: plugin-run | none |

18 more: wb_census find with module=ResourceManager kind=plugin-button.

### plugin-cli-arg (11)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:AddonBuildInfoTool#cli:-addonpath | T2/T5 | candidate: cli | none |
| plugin:AddonBuildInfoTool#cli:-ciinfodst | T2/T5 | candidate: cli | none |
| plugin:ResaveMetaPlugin#cli:-addonpath | T2/T5 | candidate: cli | none |
| plugin:ResaveMetaPlugin#cli:-extension | T2/T5 | candidate: cli | none |
| plugin:ResavePlugin#cli:-addonpath | T2/T5 | candidate: cli | none |
| plugin:ResavePlugin#cli:-extension | T2/T5 | candidate: cli | none |
| plugin:ResourceProcessorPlugin#cli:-filetypes | T2/T5 | candidate: cli | none |
| plugin:ResourceProcessorPlugin#cli:-pathcontains | T2/T5 | candidate: cli | none |
| plugin:ResourceProcessorPlugin#cli:-pathendswith | T2/T5 | candidate: cli | none |
| plugin:ResourceProcessorPlugin#cli:-pathstartswith | T2/T5 | candidate: cli | none |
| plugin:SCR_PrefabValidatorPlugin#cli:-validatepaths | T2/T5 | candidate: cli | none |

### plugin-setting (90)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:BakeMLODPlugin#attr:m_bRunInBackground | T2/T4 | candidate: plugin-run | none |
| plugin:BakeMLODPlugin#attr:m_iNumberOfSamples | T2/T4 | candidate: plugin-run | none |
| plugin:BatchTextureProcessorPlugin#attr:CheckAncestors | T2/T4 | candidate: plugin-run | none |
| plugin:BatchTextureProcessorPlugin#attr:CheckConfigurations | T2/T4 | candidate: plugin-run | none |
| plugin:BatchTextureProcessorPlugin#attr:CheckSuspiciousNonPcSetting | T2/T4 | candidate: plugin-run | none |
| plugin:BatchTextureProcessorPlugin#attr:CheckWrongPropertyValues | T2/T4 | candidate: plugin-run | none |
| plugin:BatchTextureProcessorPlugin#attr:PathContains | T2/T4 | candidate: plugin-run | none |
| plugin:BatchTextureProcessorPlugin#attr:PathEndsWith | T2/T4 | candidate: plugin-run | none |
| plugin:BatchTextureProcessorPlugin#attr:PathStartsWith | T2/T4 | candidate: plugin-run | none |
| plugin:BatchTextureProcessorPlugin#attr:ReimportChanged | T2/T4 | candidate: plugin-run | none |
| plugin:BatchTextureProcessorPlugin#attr:ReportMissingMetaFile | T2/T4 | candidate: plugin-run | none |
| plugin:BatchTextureProcessorPlugin#attr:UnnecessarySettingInPc | T2/T4 | candidate: plugin-run | none |
| plugin:EBTConfigPlugin#attr:m_aBlenderPaths | T1/T4 | candidate: plugin-run | none |
| plugin:EBTConfigPlugin#attr:m_bCopyToClipboard | T1/T4 | candidate: plugin-run | none |
| plugin:EBTConfigPlugin#attr:m_iDefaultPath | T1/T4 | candidate: plugin-run | none |
| plugin:EBTConfigPlugin#attr:m_sPath | T2/T4 | candidate: plugin-run | none |
| plugin:ResaveMetaPlugin#attr:Extensions | T2/T4 | candidate: plugin-run | none |
| plugin:ResaveMetaPlugin#attr:RootPath | T2/T4 | candidate: plugin-run | none |
| plugin:ResavePlugin#attr:Extensions | T2/T4 | candidate: plugin-run | none |
| plugin:ResavePlugin#attr:RootPath | T2/T4 | candidate: plugin-run | none |
| plugin:ResourceImportPlugin#attr:Enabled | T2/T4 | candidate: plugin-run | none |
| plugin:ResourceProcessorPlugin#attr:FileTypes | T2/T4 | candidate: plugin-run | none |
| plugin:ResourceProcessorPlugin#attr:FixCustomPropertyValues | T2/T4 | candidate: plugin-run | none |
| plugin:ResourceProcessorPlugin#attr:FixMetaFile | T2/T4 | candidate: plugin-run | none |
| plugin:ResourceProcessorPlugin#attr:ForceResaveMetaFile | T2/T4 | candidate: plugin-run | none |
| plugin:ResourceProcessorPlugin#attr:PathContains | T2/T4 | candidate: plugin-run | none |
| plugin:ResourceProcessorPlugin#attr:PathEndsWith | T2/T4 | candidate: plugin-run | none |
| plugin:ResourceProcessorPlugin#attr:PathStartsWith | T2/T4 | candidate: plugin-run | none |
| plugin:ResourceProcessorPlugin#attr:ReportCustomPropertyValues | T2/T4 | candidate: plugin-run | none |
| plugin:ResourceProcessorPlugin#attr:ReportMissingConfigurations | T2/T4 | candidate: plugin-run | none |
| plugin:ResourceProcessorPlugin#attr:ReportMissingMetaFile | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BIKIFactionAssetsExportPlugin#attr:m_aFactionConfigs | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BIKIFactionAssetsExportPlugin#attr:m_bExportCharacters | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BIKIFactionAssetsExportPlugin#attr:m_bExportGroups | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BIKIFactionAssetsExportPlugin#attr:m_bExportVehicles | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BIKIFactionAssetsExportPlugin#attr:m_bExportWeaponTripods | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BIKIFactionAssetsExportPlugin#attr:m_bExportWeapons | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BookmarkSettingsPlugin#attr:m_sBookmark_1 | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BookmarkSettingsPlugin#attr:m_sBookmark_10 | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BookmarkSettingsPlugin#attr:m_sBookmark_2 | T2/T4 | candidate: plugin-run | none |

50 more: wb_census find with module=ResourceManager kind=plugin-setting.

### property (34)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:property/Game Project: Dependencies | T0/T2 | candidate: file-format | none |
| schema:property/Model import: COM Autocenter | T0/T2 | candidate: file-format, net-api-handler | none |
| schema:property/Model import: Export Morphs | T0/T2 | candidate: net-api-handler | none |
| schema:property/Model import: Export Scene Hierarchy | T0/T2 | candidate: net-api-handler | none |
| schema:property/Model import: Export Skinning | T0/T2 | candidate: builtin-net-handler, net-api-handler | none |
| schema:property/Model import: Geometry Params | T0/T2 | candidate: builtin-net-handler, net-api-handler | none |
| schema:property/Model import: Legacy Support | T0/T2 | candidate: file-format, net-api-handler | none |
| schema:property/Model import: Material Assigns | T0/T2 | candidate: builtin-net-handler, file-format, net-api-handler | none |
| schema:property/Model import: Merge Meshes | T0/T2 | candidate: file-format, net-api-handler | none |
| schema:property/Model import: Merge Tri Meshes | T0/T2 | candidate: file-format, net-api-handler | none |
| schema:property/Model import: Modify material names | T0/T2 | candidate: file-format, net-api-handler | none |
| schema:property/Model import: No Optimize | T0/T2 | candidate: file-format, net-api-handler | none |
| schema:property/Model import: Phys Material Assigns | T0/T2 | candidate: net-api-handler | none |
| schema:property/Model import: Present | T0/T2 | candidate: file-format, net-api-handler | none |
| schema:property/Model import: Remove LODs | T0/T2 | candidate: file-format, net-api-handler | none |
| schema:property/Model import: Source File | T0/T2 | candidate: file-format, net-api-handler | none |
| schema:property/Model import: Volume Params | T0/T2 | candidate: file-format, net-api-handler | none |
| schema:property/Publish dialog: Contributors | T0/T2 | candidate: gui-automation | none |
| schema:property/Publish dialog: Project Name | T0/T2 | candidate: file-format, gui-automation | none |
| schema:property/Publish dialog: Version | T0/T2 | candidate: cli, gui-automation | none |
| schema:property/Publish dialog: Working Dir | T0/T2 | candidate: gui-automation | none |
| schema:property/Texture import: Color Space | T0/T2 | candidate: net-api-handler | none |
| schema:property/Texture import: Compress Threshold | T0/T2 | candidate: net-api-handler | none |
| schema:property/Texture import: Conversion | T0/T2 | candidate: net-api-handler | none |
| schema:property/Texture import: Conversion Quality | T0/T2 | candidate: net-api-handler | none |
| schema:property/Texture import: Format Compress | T0/T2 | candidate: net-api-handler | none |
| schema:property/Texture import: Max Size | T0/T2 | candidate: net-api-handler | none |
| schema:property/Texture import: Mip Map Filter | T0/T2 | candidate: net-api-handler | none |
| schema:property/Texture import: Mip Map Function | T0/T2 | candidate: net-api-handler | none |
| schema:property/Texture import: Original Pixel Bit Depth | T0/T2 | candidate: net-api-handler | none |
| schema:property/Texture import: Remove Mips | T0/T2 | candidate: net-api-handler | none |
| schema:property/Texture import: Swizzling | T0/T2 | candidate: net-api-handler | none |
| schema:property/Texture import: Target Format | T0/T2 | candidate: file-format, net-api-handler | none |
| schema:property/World build tags | T0/T2 | candidate: file-format, net-api-handler | none |

### property-group (9)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager/property-group/Model import: BSP options | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:ResourceManager/property-group/Model import: Common | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:ResourceManager/property-group/Model import: Transform | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:ResourceManager/property-group/Modules: Chimera Global Config | T0/T3 | candidate: file-format | none |
| ui:ResourceManager/property-group/Modules: Input Manager Settings | T0/T3 | candidate: file-format | none |
| ui:ResourceManager/property-group/Modules: Physics Settings | T0/T3 | candidate: builtin-net-handler, file-format | none |
| ui:ResourceManager/property-group/Modules: Script Project Manager Settings | T0/T3 | candidate: file-format | none |
| ui:ResourceManager/property-group/Modules: Wetness Render Settings | T0/T3 | candidate: file-format | none |
| ui:ResourceManager/property-group/Modules: Widget Manager Settings | T0/T3 | candidate: file-format | none |

### region (23)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager/region/#SystemMenuBar | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/#menubar | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/#qt_scrollarea_hcontainer | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/#qt_scrollarea_viewport | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/#qt_splithandle_ | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/#qt_splithandle_gridPanel | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/@TitleBar.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/consoleDock/consoleDockContents/@QScrollBar.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/consoleDock/consoleDockContents/@QScrollBar.2 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/consoleDock/consoleDockContents/@QSplitterHandle.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/consoleDock/consoleDockContents/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/consoleDock/consoleDockContents/@QWidget.2 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/consoleDock/consoleDockContents/ScriptConsole/@QScrollBar.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/consoleDock/consoleDockContents/ScriptConsole/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/consoleDock/consoleDockContents/ScriptConsole/@QWidget.2 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/consoleDock/consoleDockContents/ScriptConsole/@QWidget.3 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/resourceBrowserDock/resourceBrowserDockContents/@BreadcrumbTrailWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/statusbar/@QLabel.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/statusbar/@QLabel.2 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/statusbar/@QLabel.3 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/statusbar/@QLabel.4 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/statusbar/@QLabel.5 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager/region/statusbar/@QSizeGrip.1 | T0/T2 | candidate: gui-automation | none |

### schema-class (64)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:ChromAberEffect | T2/T2 | candidate: file-format | none |
| schema:ColorsEffect | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldAdvancedEffect | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldBokehEffect | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldEffect | T2/T2 | candidate: file-format | none |
| schema:FXAAEffect | T2/T2 | candidate: file-format | none |
| schema:FilmGrainEffect | T2/T2 | candidate: file-format | none |
| schema:GaussFilterEffect | T2/T2 | candidate: file-format | none |
| schema:GodRaysEffect | T2/T2 | candidate: file-format | none |
| schema:Grass | T2/T2 | candidate: file-format | none |
| schema:HBAOEffect | T2/T2 | candidate: file-format | none |
| schema:HDREffect | T2/T2 | candidate: file-format | none |
| schema:HeightmapAOEffect | T2/T2 | candidate: file-format | none |
| schema:MatAtmosphere | T2/T2 | candidate: file-format | none |
| schema:MatCommon | T2/T2 | candidate: file-format | none |
| schema:MatDeferredDecals | T2/T2 | candidate: file-format | none |
| schema:MatDistantClouds | T2/T2 | candidate: file-format | none |
| schema:MatDummy | T2/T2 | candidate: file-format | none |
| schema:MatLensFlare | T2/T2 | candidate: file-format | none |
| schema:MatLightPortal | T2/T2 | candidate: file-format | none |
| schema:MatLightSource | T2/T2 | candidate: file-format | none |
| schema:MatOcean | T2/T2 | candidate: file-format | none |
| schema:MatPBR2Layers | T2/T2 | candidate: file-format | none |
| schema:MatPBRBasic | T2/T2 | candidate: file-format | none |
| schema:MatPBRBasicGlass | T2/T2 | candidate: file-format | none |
| schema:MatPBRCable | T2/T2 | candidate: file-format | none |
| schema:MatPBRCamo | T2/T2 | candidate: file-format | none |
| schema:MatPBRDecal | T2/T2 | candidate: file-format | none |
| schema:MatPBRMulti | T2/T2 | candidate: file-format | none |
| schema:MatPBRRoad | T2/T2 | candidate: file-format | none |
| schema:MatPBRRoadEnd | T2/T2 | candidate: file-format | none |
| schema:MatPBRSkinProfile | T2/T2 | candidate: file-format | none |
| schema:MatPBRTreeCrown | T2/T2 | candidate: file-format | none |
| schema:MatPBRTreeTrunk | T2/T2 | candidate: file-format | none |
| schema:MatRiver | T2/T2 | candidate: file-format | none |
| schema:MatSkyBox | T2/T2 | candidate: file-format | none |
| schema:MatSkyColor | T2/T2 | candidate: file-format | none |
| schema:MatSkyMoon | T2/T2 | candidate: file-format | none |
| schema:MatSkySun | T2/T2 | candidate: file-format | none |
| schema:MatStarDome | T2/T2 | candidate: file-format | none |

24 more: wb_census find with module=ResourceManager kind=schema-class.

### schema-key (1830)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:ChromAberEffect.Enabled | T2/T2 | candidate: file-format | none |
| schema:ChromAberEffect.PowerX | T2/T2 | candidate: file-format | none |
| schema:ChromAberEffect.PowerY | T2/T2 | candidate: file-format | none |
| schema:ChromAberEffect.Refs | T2/T2 | candidate: file-format | none |
| schema:ColorsEffect.ColorizationColor | T2/T2 | candidate: file-format | none |
| schema:ColorsEffect.Contrast | T2/T2 | candidate: file-format | none |
| schema:ColorsEffect.DesaturationWeights | T2/T2 | candidate: file-format | none |
| schema:ColorsEffect.Enabled | T2/T2 | candidate: file-format | none |
| schema:ColorsEffect.OverlayColor | T2/T2 | candidate: file-format | none |
| schema:ColorsEffect.OverlayFactor | T2/T2 | candidate: file-format | none |
| schema:ColorsEffect.Refs | T2/T2 | candidate: file-format | none |
| schema:ColorsEffect.Saturation | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldAdvancedEffect.FlickerReduction | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldAdvancedEffect.Quality | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldBokehEffect.Enabled | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldBokehEffect.FStop | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldBokehEffect.FStopMax | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldBokehEffect.FStopMin | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldBokehEffect.FocalLength | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldBokehEffect.FocalLengthNear | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldBokehEffect.FocusDistance | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldBokehEffect.LamelsAngle | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldBokehEffect.LamelsCount | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldBokehEffect.Quality | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldBokehEffect.Refs | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldBokehEffect.WetEdges | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldEffect.BlurFactor | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldEffect.DOFLowQuality | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldEffect.Enabled | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldEffect.FocalChange | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldEffect.FocalChangeNear | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldEffect.FocalDistance | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldEffect.Refs | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldEffect.SimpleBilateral | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldEffect.SimpleDOF | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldEffect.SimpleDOFGauss | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldEffect.SimpleDOFSize | T2/T2 | candidate: file-format | none |
| schema:DepthOfFieldEffect.SkipFar | T2/T2 | candidate: file-format | none |
| schema:FXAAEffect.Preset | T2/T2 | candidate: file-format | none |
| schema:FilmGrainEffect.Frequency | T2/T2 | candidate: file-format | none |

1790 more: wb_census find with module=ResourceManager kind=schema-key.

### setting-key (78)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| setting:Resource Manager%2FConsoleEditBox/Text | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FFBXExportDialog/exportSceneHierarchy | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FFBXExportDialog/exportSkinning | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FFBXExportDialog/exportXOB | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FFBXExportDialog/mergeMeshes | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FFBXExportDialog/modifyMaterialNames | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FFBXExportDialog/triangulateByFBX | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FLogWidget%2FLogView/ContextMask | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FLogWidget%2FLogView/LogLevel_1 | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FLogWidget%2FLogView/LogLevel_16 | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FLogWidget%2FLogView/LogLevel_2 | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FLogWidget%2FLogView/LogLevel_32 | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FLogWidget%2FLogView/LogLevel_4 | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FLogWidget%2FLogView/LogLevel_64 | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FLogWidget%2FLogView/LogLevel_8 | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FLogWidget/errorsOnly | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FLogWidget/fontSize | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FLogWidget/infosOnly | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FLogWidget/showOnlyMatchingLinesAtSearch | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FLogWidget/warningsOnly | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FPerspectives%2Fdefault/Geometry | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FPerspectives%2Fdefault/State | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FResourceBrowser%2FResourceBrowser/ascendingOrder | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FResourceBrowser%2FResourceBrowser/currentItem | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FResourceBrowser%2FResourceBrowser/expandAll | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FResourceBrowser%2FResourceBrowser/favorites | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FResourceBrowser%2FResourceBrowser/gridZoom | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FResourceBrowser%2FResourceBrowser/listModeEnabled | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FResourceBrowser%2FResourceBrowser/locked | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FResourceBrowser%2FResourceBrowser/orientation | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FResourceBrowser%2FResourceBrowser/recursiveMode | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FResourceBrowser%2FResourceBrowser/root | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FResourceBrowser%2FResourceBrowser/runtimeFilterOn | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FResourceBrowser%2FResourceBrowser/showFavorites | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FResourceBrowser%2FResourceBrowser/showFavoritesFullPath | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FResourceBrowser%2FResourceBrowser/sortFavorites | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FResourceBrowser%2FResourceBrowser/sortingMethod | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FResourceBrowser%2FResourceBrowser/splitterState | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FResourceBrowser%2FResourceBrowser/splitterState2 | T0/T3 | candidate: file-format | none |
| setting:Resource Manager%2FResourceBrowser%2FResourceBrowser/tagsMatchAll | T0/T3 | candidate: file-format | none |

38 more: wb_census find with module=ResourceManager kind=setting-key.

### shortcut (70)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager/shortcut/Edit/Edit prefab | T1/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Edit/Locate file in resource browser | T1/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Edit/Redo | T1/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Edit/Reimport resource | T1/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Edit/Undo | T1/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/New Folder | T0/T2 | candidate: file-format, net-api-handler | none |
| ui:ResourceManager/shortcut/Next tab | T1/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Plugins/Localize Selected Files | T1/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Plugins/Settings/Edit Selected Prefab(s) | T1/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Plugins/Settings/Reload WB Scripts | T1/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Previous tab | T1/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Batch resource processor | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Batch texture processor | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Bookmark 1 | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Bookmark 10 | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Bookmark 2 | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Bookmark 3 | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Bookmark 4 | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Bookmark 5 | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Bookmark 6 | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Bookmark 7 | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Bookmark 8 | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Bookmark 9 | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Check Ruin Models and Usage | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Create%2FUpdate Selected Editable Prefabs | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Data To Spreadsheet plugin | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Edit Engine Settings | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Edit Game Settings | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Edit Selected Prefab(s) | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Export Assets | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/File(s) VCS Changelog | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Find Linked Resources | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Generate Class from Layout | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Generate Controls Scheme | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Image Set Generator | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Localise Selected Files | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Maintain Editable Entities | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/MultiPhase Destruction Soundless Prefab Search | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Normal-Aligned Floaters Finder | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/shortcut/Resource Manager Plugins/Prefab Template Class Check | T2/T2 | candidate: gui-automation | none |

30 more: wb_census find with module=ResourceManager kind=shortcut.

### static-method (123)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:AddonBuildInfoTool.FindAddonByAbsolutePath/4 | T2/T5 | candidate: net-api-handler | none |
| api:BakeMLODPlugin.GetInstance/0 | T2/T5 | candidate: net-api-handler | none |
| api:BakeMLODPlugin.GetOperatorDescription/4 | T2/T5 | candidate: net-api-handler | none |
| api:EBTConfigPlugin.CopyToClipboard/0 | T1/T5 | candidate: net-api-handler | none |
| api:EBTConfigPlugin.GetBlenderPath/1 | T2/T5 | candidate: net-api-handler | none |
| api:EBTConfigPlugin.GetBlenderPathFromEnumIndex/2 | T1/T5 | candidate: net-api-handler | none |
| api:EBTConfigPlugin.GetBlenderPathOrWarn/1 | T2/T5 | candidate: net-api-handler | none |
| api:EBTConfigPlugin.GetDefaultBlenderPath/1 | T2/T5 | candidate: net-api-handler | none |
| api:EBTConfigPlugin.GetRegisteredBlenderExecutables/0 | T1/T5 | candidate: net-api-handler | none |
| api:EBTConfigPlugin.HasBlenderRegistered/0 | T2/T5 | candidate: net-api-handler | none |
| api:EBTConfigPlugin.Update/0 | T1/T5 | candidate: net-api-handler | none |
| api:EBTConfigPlugin.UpdateRegisteredBlenderExecutables/0 | T1/T5 | candidate: net-api-handler | none |
| api:NewMlodBakerPlugin.ResolveRenderPasses/1 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceProcessorPlugin.FixIssue/5 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceProcessorPlugin.FixMeshObjectMetaFile/2 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceProcessorPlugin.FixParticleEffectMetaFile/2 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceProcessorPlugin.FixSoundMetaFile/2 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceProcessorPlugin.IsMeshObject/1 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceProcessorPlugin.IsParticleEffect/1 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceProcessorPlugin.IsSound/1 | T2/T5 | candidate: net-api-handler | none |
| api:ResourceProcessorPlugin.ReportIssue/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BIKIBulletHelper.GetInitialSpeed/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BIKIExportTerrainStatisticsPlugin.AddToMapResult/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BIKIExportTerrainStatisticsPlugin.GetClosestLocationName/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BIKIExportTerrainStatisticsPlugin.GetEntityStatistics/0 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BIKIExportTerrainStatisticsPlugin.GetPolylineShapeArea/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BIKIExportTerrainStatisticsPlugin.GetShapeLength/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BIKIExportTerrainStatisticsPlugin.GetTimeAndWeatherInfo/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BIKIExportTerrainStatisticsPlugin.SetBiggestValue/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BIKIFactionAssetsExportPlugin.AddFactionCatalogString/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BIKIFactionAssetsExportPlugin.AddFactionWeaponString/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BIKIFactionAssetsExportPlugin.GetCategoryResourceNames/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BIKIFactionAssetsExportPlugin.GetCharacterDetails/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BIKIFactionAssetsExportPlugin.GetCountedSortedStringArray/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BIKIFactionAssetsExportPlugin.GetDetails/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BIKIFactionAssetsExportPlugin.GetEnginePowerInfo/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BIKIFactionAssetsExportPlugin.GetFuelInfo/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BIKIFactionAssetsExportPlugin.GetGearboxInfo/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BIKIFactionAssetsExportPlugin.GetGroupDetails/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BIKIFactionAssetsExportPlugin.GetHelicopterDetails/1 | T2/T5 | candidate: net-api-handler | none |

83 more: wb_census find with module=ResourceManager kind=static-method.

### status-item (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager/status-item/statusbar/Ready | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/status-item/statusbar/Version 1.8.0.13 (production) | T2/T2 | candidate: gui-automation | none |
| ui:ResourceManager/status-item/statusbar/Version 1.9.0.37 (production) | T2/T2 | candidate: gui-automation | none |

### tab (10)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager/tab/Details | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/tab/Import Settings | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/tab/Options/Animation Editor | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/tab/Options/Audio Editor | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/tab/Options/Behavior Editor | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/tab/Options/Game Project | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/tab/Options/Script Editor | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/tab/Options/Shortcuts | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/tab/Options/Workbench | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager/tab/Options/World Editor | T1/T3 | candidate: gui-automation | none |

### toolbar-button (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager/toolbar-button/Reimport resource button | T0/T5 | candidate: net-api-handler | none |
| ui:ResourceManager/toolbar-button/Workbench: Export settings | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager/toolbar-button/Workbench: Register "enfusion:%2F%2F" protocol | T0/T5 | candidate: gui-automation | none |

### window (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager/window/#ResourceManagerMain | T1/T3 | candidate: gui-automation | none |

## Below target (1300)

- T0 to T2: 68
- T0 to T3: 148
- T0 to T5: 138
- T1 to T2: 55
- T1 to T3: 28
- T1 to T4: 3
- T1 to T5: 109
- T2 to T3: 30
- T2 to T4: 87
- T2 to T5: 619
- T3 to T5: 15

| id | tier | path |
| --- | --- | --- |
| api:AddonBuildInfoTool.FindAddonByAbsolutePath/4 | T2/T5 | candidate: net-api-handler |
| api:AddonBuildInfoTool.GenerateCiInfo/4 | T2/T5 | candidate: net-api-handler |
| api:AddonBuildInfoTool.OnEntFileFound/2 | T2/T5 | candidate: net-api-handler |
| api:AddonBuildInfoTool.Run/0 | T2/T5 | candidate: net-api-handler |
| api:AddonBuildInfoTool.TryExtractGUID/2 | T2/T5 | candidate: net-api-handler |
| api:BakeMLODPlugin.BakeMLODPlugin/0 | T2/T5 | candidate: net-api-handler |
| api:BakeMLODPlugin.ButtonOK/0 | T2/T5 | candidate: net-api-handler |
| api:BakeMLODPlugin.Configure/0 | T2/T5 | candidate: net-api-handler |
| api:BakeMLODPlugin.GetInstance/0 | T2/T5 | candidate: net-api-handler |
| api:BakeMLODPlugin.GetOperatorDescription/4 | T2/T5 | candidate: net-api-handler |
| api:BakeMLODPlugin.OnResourceContextMenu/1 | T2/T5 | candidate: net-api-handler |
| api:BakeMLODPlugin.StartBake/1 | T2/T5 | candidate: net-api-handler |
| api:BakeMLODPlugin.VoidPrint/1 | T2/T5 | candidate: net-api-handler |
| api:BatchTextureProcessorPlugin.Cancel/0 | T2/T5 | candidate: net-api-handler |
| api:BatchTextureProcessorPlugin.Find/2 | T2/T5 | candidate: net-api-handler |
| api:BatchTextureProcessorPlugin.OK/0 | T2/T5 | candidate: net-api-handler |
| api:BatchTextureProcessorPlugin.Run/0 | T2/T5 | candidate: net-api-handler |
| api:BatchTextureProcessorPlugin.TestAgainstFilter/1 | T2/T5 | candidate: net-api-handler |
| api:EBTConfigPlugin.ButtonOK/0 | T2/T5 | candidate: net-api-handler |
| api:EBTConfigPlugin.ButtonUpdateDropdownMenu/0 | T1/T5 | candidate: net-api-handler |
| api:EBTConfigPlugin.Configure/0 | T2/T5 | candidate: net-api-handler |
| api:EBTConfigPlugin.CopyToClipboard/0 | T1/T5 | candidate: net-api-handler |
| api:EBTConfigPlugin.EBTConfigPlugin/0 | T2/T5 | candidate: net-api-handler |
| api:EBTConfigPlugin.GetBlenderPath/1 | T2/T5 | candidate: net-api-handler |
| api:EBTConfigPlugin.GetBlenderPathFromEnumIndex/2 | T1/T5 | candidate: net-api-handler |
| api:EBTConfigPlugin.GetBlenderPathOrWarn/1 | T2/T5 | candidate: net-api-handler |
| api:EBTConfigPlugin.GetDefaultBlenderPath/1 | T2/T5 | candidate: net-api-handler |
| api:EBTConfigPlugin.GetRegisteredBlenderExecutables/0 | T1/T5 | candidate: net-api-handler |
| api:EBTConfigPlugin.HasBlenderRegistered/0 | T2/T5 | candidate: net-api-handler |
| api:EBTConfigPlugin.Update/0 | T1/T5 | candidate: net-api-handler |
| api:EBTConfigPlugin.UpdateRegisteredBlenderExecutables/0 | T1/T5 | candidate: net-api-handler |
| api:NewMlodBakerPlugin.CreateBakeRequest/2 | T2/T5 | candidate: net-api-handler |
| api:NewMlodBakerPlugin.GetMlodMaterial/1 | T2/T5 | candidate: net-api-handler |
| api:NewMlodBakerPlugin.OnResourceContextMenu/1 | T2/T5 | candidate: net-api-handler |
| api:NewMlodBakerPlugin.ResolveRenderPasses/1 | T2/T5 | candidate: net-api-handler |
| api:NewMlodBakerPlugin.ValidateXOBResource/1 | T2/T5 | candidate: net-api-handler |
| api:ResaveMetaPlugin.Cancel/0 | T2/T5 | candidate: net-api-handler |
| api:ResaveMetaPlugin.Find/2 | T2/T5 | candidate: net-api-handler |
| api:ResaveMetaPlugin.OK/0 | T2/T5 | candidate: net-api-handler |
| api:ResaveMetaPlugin.Resave/0 | T2/T5 | candidate: net-api-handler |
| api:ResaveMetaPlugin.Run/0 | T2/T5 | candidate: net-api-handler |
| api:ResavePlugin.Cancel/0 | T2/T5 | candidate: net-api-handler |
| api:ResavePlugin.Find/1 | T2/T5 | candidate: net-api-handler |
| api:ResavePlugin.OK/0 | T2/T5 | candidate: net-api-handler |
| api:ResavePlugin.Resave/0 | T2/T5 | candidate: net-api-handler |
| api:ResavePlugin.Run/0 | T2/T5 | candidate: net-api-handler |
| api:ResourceImportPlugin.Configure/0 | T2/T5 | candidate: net-api-handler |
| api:ResourceImportPlugin.OkButton/0 | T2/T5 | candidate: net-api-handler |
| api:ResourceImportPlugin.OnGetMaterialGenerateDir/1 | T2/T5 | candidate: net-api-handler |
| api:ResourceImportPlugin.OnRegisterResource/2 | T2/T5 | candidate: net-api-handler |
| api:ResourceImportPlugin.ResourceImportPlugin/0 | T2/T5 | candidate: net-api-handler |
| api:ResourceManager.GetResourceBrowserSelection/2 | T3/T5 | candidate: net-api-handler |
| api:ResourceManagerPlugin.OnBuildResource/5 | T2/T5 | candidate: net-api-handler |
| api:ResourceManagerPlugin.OnGetMaterialClassName/2 | T2/T5 | candidate: net-api-handler |
| api:ResourceManagerPlugin.OnGetMaterialGenerateDir/1 | T2/T5 | candidate: net-api-handler |
| api:ResourceManagerPlugin.OnMaterialCreated/3 | T2/T5 | candidate: net-api-handler |
| api:ResourceManagerPlugin.OnRegisterResource/2 | T2/T5 | candidate: net-api-handler |
| api:ResourceManagerPlugin.OnRenameResource/3 | T2/T5 | candidate: net-api-handler |
| api:ResourceProcessorPlugin.Cancel/0 | T2/T5 | candidate: net-api-handler |
| api:ResourceProcessorPlugin.CheckContainersVar/5 | T2/T5 | candidate: net-api-handler |

1240 more: wb_census find with module=ResourceManager.

## Dispositions (204)

| id | kind | why | evidence |
| --- | --- | --- | --- |
| api:AddonBuildInfoTool.FindAddonByAbsolutePath/4 | subsumed-by | subsumed-by plugin:AddonBuildInfoTool (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:AddonBuildInfoTool at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:AddonBuildInfoTool.GenerateCiInfo/4 | subsumed-by | subsumed-by plugin:AddonBuildInfoTool (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:AddonBuildInfoTool at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:AddonBuildInfoTool.OnEntFileFound/2 | subsumed-by | subsumed-by plugin:AddonBuildInfoTool (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:AddonBuildInfoTool at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:AddonBuildInfoTool.Run/0 | subsumed-by | subsumed-by plugin:AddonBuildInfoTool (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:AddonBuildInfoTool at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:AddonBuildInfoTool.RunCommandline/0 | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| api:AddonBuildInfoTool.TryExtractGUID/2 | subsumed-by | subsumed-by plugin:AddonBuildInfoTool (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:AddonBuildInfoTool at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResaveMetaPlugin.Cancel/0 | subsumed-by | subsumed-by plugin:ResaveMetaPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResaveMetaPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResaveMetaPlugin.Find/2 | subsumed-by | subsumed-by plugin:ResaveMetaPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResaveMetaPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResaveMetaPlugin.OK/0 | subsumed-by | subsumed-by plugin:ResaveMetaPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResaveMetaPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResaveMetaPlugin.Resave/0 | subsumed-by | subsumed-by plugin:ResaveMetaPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResaveMetaPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResaveMetaPlugin.Run/0 | subsumed-by | subsumed-by plugin:ResaveMetaPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResaveMetaPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResaveMetaPlugin.RunCommandline/0 | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| api:ResavePlugin.Cancel/0 | subsumed-by | subsumed-by plugin:ResavePlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResavePlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResavePlugin.Find/1 | subsumed-by | subsumed-by plugin:ResavePlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResavePlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResavePlugin.OK/0 | subsumed-by | subsumed-by plugin:ResavePlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResavePlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResavePlugin.Resave/0 | subsumed-by | subsumed-by plugin:ResavePlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResavePlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResavePlugin.Run/0 | subsumed-by | subsumed-by plugin:ResavePlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResavePlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResavePlugin.RunCommandline/0 | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| api:ResourceProcessorPlugin.Cancel/0 | subsumed-by | subsumed-by plugin:ResourceProcessorPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceProcessorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResourceProcessorPlugin.CheckContainersVar/5 | subsumed-by | subsumed-by plugin:ResourceProcessorPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceProcessorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResourceProcessorPlugin.Execute/0 | subsumed-by | subsumed-by plugin:ResourceProcessorPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceProcessorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResourceProcessorPlugin.Find/2 | subsumed-by | subsumed-by plugin:ResourceProcessorPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceProcessorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResourceProcessorPlugin.FixIssue/5 | subsumed-by | subsumed-by plugin:ResourceProcessorPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceProcessorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResourceProcessorPlugin.FixMeshObjectMetaFile/2 | subsumed-by | subsumed-by plugin:ResourceProcessorPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceProcessorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResourceProcessorPlugin.FixParticleEffectMetaFile/2 | subsumed-by | subsumed-by plugin:ResourceProcessorPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceProcessorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResourceProcessorPlugin.FixSoundMetaFile/2 | subsumed-by | subsumed-by plugin:ResourceProcessorPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceProcessorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResourceProcessorPlugin.IsMeshObject/1 | subsumed-by | subsumed-by plugin:ResourceProcessorPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceProcessorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResourceProcessorPlugin.IsParticleEffect/1 | subsumed-by | subsumed-by plugin:ResourceProcessorPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceProcessorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResourceProcessorPlugin.IsSound/1 | subsumed-by | subsumed-by plugin:ResourceProcessorPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceProcessorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResourceProcessorPlugin.OK/0 | subsumed-by | subsumed-by plugin:ResourceProcessorPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceProcessorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResourceProcessorPlugin.ReportIssue/2 | subsumed-by | subsumed-by plugin:ResourceProcessorPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceProcessorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResourceProcessorPlugin.ResourceProcessorPlugin/0 | subsumed-by | subsumed-by plugin:ResourceProcessorPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceProcessorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResourceProcessorPlugin.Run/0 | subsumed-by | subsumed-by plugin:ResourceProcessorPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceProcessorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ResourceProcessorPlugin.RunCommandline/0 | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| api:ResourceProcessorPlugin.TestAgainstFilter/1 | subsumed-by | subsumed-by plugin:ResourceProcessorPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceProcessorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_CheckRuinModelsAndUsagePlugin.Run/0 | blocked | blocked:P-W6-05 until this class passes [ledger work_item W2] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| api:SCR_CreateEditablePrefabsPluginResourceManager.GetSelected/1 | subsumed-by | subsumed-by plugin:SCR_CreateEditablePrefabsPluginResourceManager (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_CreateEditablePrefabsPluginResourceManager at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_PrefabValidatorPlugin.Run/0 | subsumed-by | subsumed-by plugin:SCR_PrefabValidatorPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_PrefabValidatorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_PrefabValidatorPlugin.RunCommandline/0 | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| api:SCR_PrefabValidatorPlugin.ValidateEntitySource/3 | subsumed-by | subsumed-by plugin:SCR_PrefabValidatorPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_PrefabValidatorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_PrefabValidatorPlugin.ValidatePrefabs/1 | subsumed-by | subsumed-by plugin:SCR_PrefabValidatorPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_PrefabValidatorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_ReforgerEngineSettingsPlugin.Run/0 | blocked | blocked:P-W6-05 until this class passes [ledger work_item W2] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| api:SCR_ReforgerGameSettingsPlugin.Run/0 | blocked | blocked:P-W6-05 until this class passes [ledger work_item W2] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| api:SCR_RegisterPlaceableEntitiesPlugin.Cancel/0 | subsumed-by | subsumed-by plugin:SCR_RegisterPlaceableEntitiesPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_RegisterPlaceableEntitiesPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_RegisterPlaceableEntitiesPlugin.OK/0 | subsumed-by | subsumed-by plugin:SCR_RegisterPlaceableEntitiesPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_RegisterPlaceableEntitiesPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_RegisterPlaceableEntitiesPlugin.Run/0 | subsumed-by | subsumed-by plugin:SCR_RegisterPlaceableEntitiesPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_RegisterPlaceableEntitiesPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_RegisterPlaceableEntitiesPlugin.RunCommandline/0 | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| api:SCR_RegisterPlaceableEntitiesPlugin.Scan/0 | subsumed-by | subsumed-by plugin:SCR_RegisterPlaceableEntitiesPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_RegisterPlaceableEntitiesPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_SearchXOBFunctor.PrintHeader/0 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_SearchXOBFunctor.PrintResults/0 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_SearchXOBFunctor.ProcessFile/1 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_SearchXOBFunctor.SCR_SearchXOBFunctor/4 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_SearchXOBFunctor.Search/0 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_SearchXOBInvalidMaskFunctor.PrintHeader/0 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_SearchXOBInvalidMaskFunctor.PrintResults/0 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_SearchXOBInvalidMaskFunctor.ProcessFile/1 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_SearchXOBLayerMaskFunctor.PrintHeader/0 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_SearchXOBLayerMaskFunctor.PrintResults/0 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_SearchXOBLayerMaskFunctor.ProcessFile/1 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_SearchXOBLayerMaskFunctor.SCR_SearchXOBLayerMaskFunctor/6 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_SearchXOBListAllFunctor.PrintHeader/0 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_SearchXOBListAllFunctor.PrintResults/0 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_SearchXOBListAllFunctor.ProcessFile/1 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_SearchXOBLoadAllFunctor.PrintHeader/0 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_SearchXOBLoadAllFunctor.PrintResults/0 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_SearchXOBLoadAllFunctor.ProcessFile/1 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SearchXOBPlugin.Cancel/0 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SearchXOBPlugin.CreateFunctor/0 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SearchXOBPlugin.GetLayerMask/0 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SearchXOBPlugin.OK/0 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SearchXOBPlugin.Run/0 | subsumed-by | subsumed-by plugin:SearchXOBPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SearchXOBPlugin.RunCommandline/0 | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| api:ValidateFBXPlugin.Cancel/0 | subsumed-by | subsumed-by plugin:ValidateFBXPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ValidateFBXPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ValidateFBXPlugin.FillAssetTypes/0 | subsumed-by | subsumed-by plugin:ValidateFBXPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ValidateFBXPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ValidateFBXPlugin.GetAssetTypes/0 | subsumed-by | subsumed-by plugin:ValidateFBXPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ValidateFBXPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ValidateFBXPlugin.OK/0 | subsumed-by | subsumed-by plugin:ValidateFBXPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ValidateFBXPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ValidateFBXPlugin.OnResourceContextMenu/1 | subsumed-by | subsumed-by plugin:ValidateFBXPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ValidateFBXPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:ValidateFBXPlugin.Run/0 | subsumed-by | subsumed-by plugin:ValidateFBXPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ValidateFBXPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| cli:-builddata | blocked | blocked:P-W2-23 (-buildData stall, DEC-047 L7); wb_build_data gains the flag (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-excludetypes | blocked | blocked:P-W2-23 (-buildData stall, DEC-047 L7); wb_build_data gains the flag (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-filterpath | blocked | blocked:P-W2-23 (-buildData stall, DEC-047 L7); wb_build_data gains the flag (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-filtertags | blocked | blocked:P-W2-23 (-buildData stall, DEC-047 L7); wb_build_data gains the flag (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-imagesetbuild | blocked | blocked:P-W2-23 (CLI verb not on the cli_run allow-list; main adds it after the probe) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-imagesettexture | blocked | blocked:P-W2-23 (CLI verb not on the cli_run allow-list; main adds it after the probe) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-includetypes | blocked | blocked:P-W2-23 (-buildData stall, DEC-047 L7); wb_build_data gains the flag (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-loadbuiltdata | blocked | blocked:P-W2-23 (-buildData stall, DEC-047 L7); wb_build_data gains the flag (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-metafiles | blocked | blocked:P-W2-23 (-buildData stall, DEC-047 L7); wb_build_data gains the flag (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-publishaddon | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| cli:-publishaddoncachedir | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| cli:-publishaddonchangenote | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| cli:-publishaddonchangenotefile | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| cli:-publishaddondir | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| cli:-publishaddonpreviewimage | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| cli:-publishaddonscreenshots | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| cli:-publishaddonversion | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| cli:-resavedata | blocked | blocked:P-W2-23 (unmeasured verb, policy.json cli_run) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-wbbackendlogin | excluded-policy | DEC-056 ruling 15: risk credential (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| file:.dlg | blocked | Only the executable holds the .dlg extension; whether the Dialogue Editor is reachable in this build and whether anything consumes .dlg is P-U23. | EV-s001-003 |
| file:.fbxa | blocked | The executable holds the .fbxa extension as a string and no static source describes it; which editor opens or writes it is P-FILETYPES-EXE. | EV-s001-003 |
| file:.ragdoll | blocked | blocked:P-W2-24 (BaseContainer text? then config_edit.read) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| net:handler/ExportMaterialResource | subsumed-by | subsumed-by wb_resources.create (proposal docs/v2/inbox/w2/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_resources.create at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| net:handler/ExportTXAResource#req:DiffData | absent-in-build | absent-in-build: 1.8 request field; 1.9.0.37 renamed the request (sourceFile, targetFile, profile, numberOfChannels, ...) and dropped ProfileDirectory (proposal docs/v2/inbox/w4/remainder.jsonl; last seen 1.8.0.13; E04 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| net:handler/ExportTXAResource#req:Fps | absent-in-build | absent-in-build: 1.8 request field; 1.9.0.37 renamed the request (sourceFile, targetFile, profile, numberOfChannels, ...) and dropped ProfileDirectory (proposal docs/v2/inbox/w4/remainder.jsonl; last seen 1.8.0.13; E04 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| net:handler/ExportTXAResource#req:KeyData | absent-in-build | absent-in-build: 1.8 request field; 1.9.0.37 renamed the request (sourceFile, targetFile, profile, numberOfChannels, ...) and dropped ProfileDirectory (proposal docs/v2/inbox/w4/remainder.jsonl; last seen 1.8.0.13; E04 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| net:handler/ExportTXAResource#req:NumChannels | absent-in-build | absent-in-build: 1.8 request field; 1.9.0.37 renamed the request (sourceFile, targetFile, profile, numberOfChannels, ...) and dropped ProfileDirectory (proposal docs/v2/inbox/w4/remainder.jsonl; last seen 1.8.0.13; E04 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| net:handler/ExportTXAResource#req:NumKeyframes | absent-in-build | absent-in-build: 1.8 request field; 1.9.0.37 renamed the request (sourceFile, targetFile, profile, numberOfChannels, ...) and dropped ProfileDirectory (proposal docs/v2/inbox/w4/remainder.jsonl; last seen 1.8.0.13; E04 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| net:handler/ExportTXAResource#req:Profile | absent-in-build | absent-in-build: 1.8 request field; 1.9.0.37 renamed the request (sourceFile, targetFile, profile, numberOfChannels, ...) and dropped ProfileDirectory (proposal docs/v2/inbox/w4/remainder.jsonl; last seen 1.8.0.13; E04 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| net:handler/ExportTXAResource#req:ProfileDirectory | absent-in-build | absent-in-build: 1.8 request field; 1.9.0.37 renamed the request (sourceFile, targetFile, profile, numberOfChannels, ...) and dropped ProfileDirectory (proposal docs/v2/inbox/w4/remainder.jsonl; last seen 1.8.0.13; E04 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| net:handler/ExportTXAResource#req:SourceFile | absent-in-build | absent-in-build: 1.8 request field; 1.9.0.37 renamed the request (sourceFile, targetFile, profile, numberOfChannels, ...) and dropped ProfileDirectory (proposal docs/v2/inbox/w4/remainder.jsonl; last seen 1.8.0.13; E04 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| net:handler/ExportTXAResource#req:TargetFile | absent-in-build | absent-in-build: 1.8 request field; 1.9.0.37 renamed the request (sourceFile, targetFile, profile, numberOfChannels, ...) and dropped ProfileDirectory (proposal docs/v2/inbox/w4/remainder.jsonl; last seen 1.8.0.13; E04 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| net:handler/ExportTextureResource | subsumed-by | subsumed-by wb_resources.import (P-W2-25 confirms the body) (proposal docs/v2/inbox/w2/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_resources.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| net:handler/GetPortalMat | blocked | blocked:P-W6-11 (unbounded queue time: Resource.Load on every .emat) [ledger work_item W2] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| net:handler/MaterialValidator | subsumed-by | subsumed-by wb_validate.material (handler indexes a dialog-only static array) (proposal docs/v2/inbox/w2/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_validate.material at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| net:handler/RegisterResource | subsumed-by | subsumed-by wb_resources.import (proposal docs/v2/inbox/w2/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_resources.import at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| net:handler/TextureValidator | subsumed-by | subsumed-by wb_validate.texture (findings go only to the log) (proposal docs/v2/inbox/w2/remainder.jsonl; reference resolved as MCP tool action name; mcp:action/wb_validate.texture at T5, target T5, on 1.9.0.37) | EV-P6-BK1-007 |
| plugin:AddonBuildInfoTool | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| plugin:ResaveMetaPlugin | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| plugin:ResaveMetaPlugin#button:Cancel | subsumed-by | subsumed-by plugin:ResaveMetaPlugin (dialog button) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResaveMetaPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:ResaveMetaPlugin#button:OK | subsumed-by | subsumed-by plugin:ResaveMetaPlugin (dialog button) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResaveMetaPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:ResaveMetaPlugin#cli:-addonpath | blocked | blocked:P-W6-08 until the headless run passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:ResaveMetaPlugin#cli:-extension | blocked | blocked:P-W6-08 until the headless run passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:ResavePlugin | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| plugin:ResavePlugin#button:Cancel | subsumed-by | subsumed-by plugin:ResavePlugin (dialog button) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResavePlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:ResavePlugin#button:OK | subsumed-by | subsumed-by plugin:ResavePlugin (dialog button) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResavePlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:ResavePlugin#cli:-addonpath | blocked | blocked:P-W6-08 until the headless run passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:ResavePlugin#cli:-extension | blocked | blocked:P-W6-08 until the headless run passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:ResourceProcessorPlugin | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| plugin:ResourceProcessorPlugin#button:Cancel | subsumed-by | subsumed-by plugin:ResourceProcessorPlugin (dialog button) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceProcessorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:ResourceProcessorPlugin#button:OK | subsumed-by | subsumed-by plugin:ResourceProcessorPlugin (dialog button) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceProcessorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:ResourceProcessorPlugin#cli:-filetypes | blocked | blocked:P-W6-08 until the headless run passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:ResourceProcessorPlugin#cli:-pathcontains | blocked | blocked:P-W6-08 until the headless run passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:ResourceProcessorPlugin#cli:-pathendswith | blocked | blocked:P-W6-08 until the headless run passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:ResourceProcessorPlugin#cli:-pathstartswith | blocked | blocked:P-W6-08 until the headless run passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:SCR_CheckRuinModelsAndUsagePlugin | blocked | blocked:P-W6-05 until this class passes its run probe (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:SCR_CreateEditablePrefabsPluginResourceManager | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| plugin:SCR_CreateEditablePrefabsPluginResourceManager#button:ButtonClose | subsumed-by | subsumed-by plugin:SCR_CreateEditablePrefabsPluginResourceManager (dialog button) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_CreateEditablePrefabsPluginResourceManager at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SCR_PrefabValidatorPlugin | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| plugin:SCR_PrefabValidatorPlugin#cli:-validatepaths | blocked | blocked:P-W6-08 until the headless run passes (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:SCR_ReforgerEngineSettingsPlugin | blocked | blocked:P-W6-05 until this class passes its run probe (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:SCR_ReforgerGameSettingsPlugin | blocked | blocked:P-W6-05 until this class passes its run probe (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:SCR_RegisterPlaceableEntitiesPlugin | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| plugin:SCR_RegisterPlaceableEntitiesPlugin#button:Cancel | subsumed-by | subsumed-by plugin:SCR_RegisterPlaceableEntitiesPlugin (dialog button) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_RegisterPlaceableEntitiesPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SCR_RegisterPlaceableEntitiesPlugin#button:OK | subsumed-by | subsumed-by plugin:SCR_RegisterPlaceableEntitiesPlugin (dialog button) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_RegisterPlaceableEntitiesPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SearchXOBPlugin | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| plugin:SearchXOBPlugin#button:Cancel | subsumed-by | subsumed-by plugin:SearchXOBPlugin (dialog button) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SearchXOBPlugin#button:OK | subsumed-by | subsumed-by plugin:SearchXOBPlugin (dialog button) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:ValidateFBXPlugin | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| plugin:ValidateFBXPlugin#button:Cancel | subsumed-by | subsumed-by plugin:ValidateFBXPlugin (dialog button) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ValidateFBXPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:ValidateFBXPlugin#button:OK | subsumed-by | subsumed-by plugin:ValidateFBXPlugin (dialog button) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ValidateFBXPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/Batch resource processor (ResourceProcessorPlugin) | duplicate-of | duplicate-of:plugin:ResourceProcessorPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceProcessorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/Build shore map (BuildShoreMap) | duplicate-of | duplicate-of:plugin:BuildShoreMap (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:BuildShoreMap at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/Generate addon.ci-info files (AddonBuildInfoTool) | duplicate-of | duplicate-of:plugin:AddonBuildInfoTool (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:AddonBuildInfoTool at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/Re-Save Meta Tool (ResaveMetaPlugin) | duplicate-of | duplicate-of:plugin:ResaveMetaPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResaveMetaPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/Re-Save Tool (ResavePlugin) | duplicate-of | duplicate-of:plugin:ResavePlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResavePlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/Regenerate river flow-maps (GenerateFlowMaps) | duplicate-of | duplicate-of:plugin:GenerateFlowMaps (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:GenerateFlowMaps at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/Register Placeable Entities... (SCR_RegisterPlaceableEntitiesPlugin) | duplicate-of | duplicate-of:plugin:SCR_RegisterPlaceableEntitiesPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_RegisterPlaceableEntitiesPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/ResourceTest Plugin (ResourceTestPlugin) | duplicate-of | duplicate-of:plugin:ResourceTestPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceTestPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/Update All Editable Prefabs | duplicate-of | duplicate-of:plugin:SCR_UpdateAllEditablePrefabsPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/Validate Prefabs (SCR_PrefabValidatorPlugin) | duplicate-of | duplicate-of:plugin:SCR_PrefabValidatorPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_PrefabValidatorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/World Data Export Plugin (WorldDataExport) | duplicate-of | duplicate-of:plugin:WorldDataExport (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldDataExport at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/WorldTest Plugin (WorldTestPlugin) | duplicate-of | duplicate-of:plugin:WorldTestPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldTestPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| setting:setting-key/Workbench: FPS limit | blocked | Only the executable declares the FPSLimit option and the registry export holds no saved value for it; the Options walk of P-U38 reads it live. | EV-s001-003 |
| setting:setting-key/Workbench: Invert mouse | blocked | Only the executable declares the InvertMouse option and the registry export holds no saved value for it; the Options walk of P-U38 reads it live. | EV-s001-003 |
| setting:setting-key/Workbench: Qt Style Sheet | blocked | The wiki names a Qt Style Sheet field in the Options dialog, but no option identifier for it is in the executable strings; the Options walk of P-U38 reads it live. | EV-s001-003 |
| setting:setting-key/Workbench: Use SVN integration | blocked | Only the executable declares the UseSVNIntegration option and the registry export holds no saved value for it; the Options walk of P-U38 reads it live. | EV-s001-003 |
| ui:ResourceManager/context-item/File view/Delete | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/context-item/Tree view/Delete | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/control/Login/Create Account | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/control/Login/Forgot Password? | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/control/Login/Login | excluded-policy | DEC-056 ruling 15: risk credential (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/control/Login/email | excluded-policy | DEC-056 ruling 15: risk credential (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/control/Login/password | excluded-policy | DEC-056 ruling 15: risk credential (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/control/Publish Project/Category | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/control/Publish Project/Change Notes | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/control/Publish Project/Contributors | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/control/Publish Project/Description | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/control/Publish Project/License | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/control/Publish Project/Preview Image | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/control/Publish Project/Project Name | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/control/Publish Project/Publish | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/control/Publish Project/Screenshots | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/control/Publish Project/Summary | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/control/Publish Project/Tags | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/control/Publish Project/Version | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/control/Publish Project/Visibility | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/control/Publish Project/Working Dir | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/dialog/Login | excluded-policy | DEC-056 ruling 15: risk credential (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/dialog/Publish Project | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/menu-item/File/Exit | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/menu-item/File/Publish to Workshop | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/menu-item/File/Remove from Workshop | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/menu-item/Plugins/Batch resource processor | blocked | blocked:P-W6-08 until the headless run passes [ledger work_item W2] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| ui:ResourceManager/menu-item/Plugins/Check Ruin Models and Usage | blocked | blocked:P-W6-05 until this class passes its run probe [ledger work_item W2] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| ui:ResourceManager/menu-item/Plugins/Prefabs/Validate Prefabs | blocked | blocked:P-W6-08 until the headless run passes [ledger work_item W2] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| ui:ResourceManager/menu-item/Plugins/Re-Save Meta Tool | blocked | blocked:P-W6-08 until the headless run passes [ledger work_item W2] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| ui:ResourceManager/menu-item/Plugins/Re-Save Tool | blocked | blocked:P-W6-08 until the headless run passes [ledger work_item W2] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| ui:ResourceManager/menu-item/Plugins/Search Tool (XOBs) | blocked | blocked:P-W6-08 until the headless run passes [ledger work_item W2] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| ui:ResourceManager/menu-item/Plugins/Settings/Clear All Settings | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/menu-item/Plugins/User Settings/Edit Engine Settings | blocked | blocked:P-W6-05 until this class passes its run probe [ledger work_item W2] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| ui:ResourceManager/menu-item/Plugins/User Settings/Edit Game Settings | blocked | blocked:P-W6-05 until this class passes its run probe [ledger work_item W2] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| ui:ResourceManager/menu-item/Window/Reset Default Layouts | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/menu-item/Workbench/Check Pending Invitation | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/menu-item/Workbench/Login%2FLogout | excluded-policy | DEC-056 ruling 15: risk credential (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ResourceManager/menu-item/Workbench/Publish Project | excluded-policy | DEC-056 ruling 15: risk external (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
