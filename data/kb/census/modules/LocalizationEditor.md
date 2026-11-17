# Census: LocalizationEditor

428 rows (8 aggregate excluded).

## What it is

Module LocalizationEditor: api 220, cli 5, file 7, link 2, mcp 33, plugin 42, schema 12, setting 1, ui 106. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- class CheckLocalizationPlugin (api:CheckLocalizationPlugin)
- class CheckLocalizationPluginReport (api:CheckLocalizationPluginReport)
- class CheckLocalizationPluginReportEntry (api:CheckLocalizationPluginReportEntry)
- class LocParserManager (api:LocParserManager)
- class LocParserRule (api:LocParserRule): Localisation rule controlled by LocParserManager.
- class LocParserRule_Custom (api:LocParserRule_Custom)
- class LocParserRule_Custom_BaseParam (api:LocParserRule_Custom_BaseParam)
- class LocParserRule_Custom_EnumParam (api:LocParserRule_Custom_EnumParam)
- class LocParserRule_Custom_HintParam (api:LocParserRule_Custom_HintParam)
- class LocParserRule_Custom_IndexParam (api:LocParserRule_Custom_IndexParam)
- class LocParserRule_Custom_NotificationParam (api:LocParserRule_Custom_NotificationParam)
- class LocParserRule_Custom_ResourceNameParam (api:LocParserRule_Custom_ResourceNameParam)
- ... 45 more

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| api | 10 | 0 | 200 | 4 | 0 | 6 | 220 |
| cli | 3 | 0 | 2 | 0 | 0 | 0 | 5 |
| file | 6 | 0 | 1 | 0 | 0 | 0 | 7 |
| link | 0 | 1 | 1 | 0 | 0 | 0 | 2 |
| mcp | 3 | 0 | 5 | 2 | 0 | 23 | 33 |
| plugin | 9 | 0 | 33 | 0 | 0 | 0 | 42 |
| schema | 12 | 0 | 0 | 0 | 0 | 0 | 12 |
| setting | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| ui | 35 | 6 | 64 | 1 | 0 | 0 | 106 |

## By kind

- attribute: 48
- class: 36
- cli-switch: 5
- control: 10
- enum: 2
- enum-value: 11
- event: 23
- file-type: 7
- handler-action: 16
- link-format: 2
- mcp-action: 16
- mcp-tool: 1
- menu: 9
- menu-item: 45
- method: 92
- module: 2
- option: 1
- panel: 11
- plugin: 17
- plugin-button: 8
- plugin-setting: 17
- property: 12
- property-group: 1
- region: 5
- setting-key: 1
- shortcut: 20
- static-method: 8
- status-item: 1
- window: 1

## By risk

- destructive: 5
- mutating: 240
- safe: 183

## Rows by kind

### attribute (48)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:LocParserManager#attr:m_StringTablePath | T2/T2 | candidate: net-api-handler | none |
| api:LocParserManager#attr:m_aRules | T2/T2 | candidate: net-api-handler | none |
| api:LocParserManager#attr:m_sPlaceholderPrefix | T2/T2 | candidate: net-api-handler | none |
| api:LocParserManager#attr:m_sPrefix | T2/T2 | candidate: net-api-handler | none |
| api:LocParserRule#attr:m_ItemTemplate | T2/T2 | candidate: net-api-handler | none |
| api:LocParserRule_Custom#attr:m_IdParam1 | T2/T2 | candidate: net-api-handler | none |
| api:LocParserRule_Custom#attr:m_IdParam2 | T2/T2 | candidate: net-api-handler | none |
| api:LocParserRule_Custom#attr:m_IdParam3 | T2/T2 | candidate: net-api-handler | none |
| api:LocParserRule_Custom#attr:m_iParentDepth | T2/T2 | candidate: net-api-handler | none |
| api:LocParserRule_Custom#attr:m_iParentType | T2/T2 | candidate: net-api-handler | none |
| api:LocParserRule_Custom#attr:m_sIdFormat | T2/T2 | candidate: net-api-handler | none |
| api:LocParserRule_Custom#attr:m_sParentName | T2/T2 | candidate: net-api-handler | none |
| api:LocParserRule_Custom#attr:m_sRemove | T2/T2 | candidate: net-api-handler | none |
| api:LocParserRule_Custom#attr:m_sVarName | T2/T2 | candidate: net-api-handler | none |
| api:LocParserRule_Custom_BaseParam#attr:m_iParentDepth | T2/T2 | candidate: net-api-handler | none |
| api:LocParserRule_Custom_EnumParam#attr:m_bIsFlag | T2/T2 | candidate: net-api-handler | none |
| api:LocParserRule_Custom_EnumParam#attr:m_sEnumName | T2/T2 | candidate: net-api-handler | none |
| api:LocParserRule_Custom_EnumParam#attr:m_sParamName | T2/T2 | candidate: net-api-handler | none |
| api:LocParserRule_Custom_HintParam#attr:m_sParamName | T2/T2 | candidate: net-api-handler | none |
| api:LocParserRule_Custom_NotificationParam#attr:m_sParamName | T2/T2 | candidate: net-api-handler | none |
| api:LocParserRule_Custom_ResourceNameParam#attr:m_sParamName | T2/T2 | candidate: net-api-handler | none |
| api:LocParserRule_Custom_StringParam#attr:m_sParamName | T2/T2 | candidate: net-api-handler | none |
| api:TranslationPluginConfigLocaleMatch#attr:m_sFileLocale | T2/T2 | candidate: net-api-handler | none |
| api:TranslationPluginConfigLocaleMatch#attr:m_sServerLocale | T2/T2 | candidate: net-api-handler | none |
| api:TranslationPluginMatchConfig#attr:m_aLocalesDictionary | T2/T2 | candidate: net-api-handler | none |
| api:TranslationPluginMatchConfig#attr:m_sCommentField | T2/T2 | candidate: net-api-handler | none |
| api:TranslationPluginMatchConfig#attr:m_sDefaultSource | T2/T2 | candidate: net-api-handler | none |
| api:TranslationPluginMatchConfig#attr:m_sDefaultSourceEdited | T2/T2 | candidate: net-api-handler | none |
| api:TranslationPluginMatchConfig#attr:m_sGenderField | T2/T2 | candidate: net-api-handler | none |
| api:TranslationPluginMatchConfig#attr:m_sIdField | T2/T2 | candidate: net-api-handler | none |
| api:TranslationPluginMatchConfig#attr:m_sLocaleFieldsPrefix | T2/T2 | candidate: net-api-handler | none |
| api:TranslationPluginMatchConfig#attr:m_sLocaleFieldsSuffix | T2/T2 | candidate: net-api-handler | none |
| api:TranslationPluginMatchConfig#attr:m_sMaxLengthField | T2/T2 | candidate: net-api-handler | none |
| api:TranslationPluginMatchConfig#attr:m_sSkipField | T2/T2 | candidate: net-api-handler | none |
| api:TranslationPluginResultHolder#attr:cs_cz | T2/T2 | candidate: net-api-handler | none |
| api:TranslationPluginResultHolder#attr:de_de | T2/T2 | candidate: net-api-handler | none |
| api:TranslationPluginResultHolder#attr:en_us | T2/T2 | candidate: net-api-handler | none |
| api:TranslationPluginResultHolder#attr:es_es | T2/T2 | candidate: net-api-handler | none |
| api:TranslationPluginResultHolder#attr:fr_fr | T2/T2 | candidate: net-api-handler | none |
| api:TranslationPluginResultHolder#attr:it_it | T2/T2 | candidate: net-api-handler | none |

8 more: wb_census find with module=LocalizationEditor kind=attribute.

### class (36)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:CheckLocalizationPlugin | T2/T2 | candidate: none-known | none |
| api:CheckLocalizationPluginReport | T2/T2 | candidate: none-known | none |
| api:CheckLocalizationPluginReportEntry | T2/T2 | candidate: none-known | none |
| api:LocParserManager | T2/T2 | candidate: none-known | none |
| api:LocParserRule | T2/T2 | candidate: none-known | none |
| api:LocParserRule_Custom | T2/T2 | candidate: none-known | none |
| api:LocParserRule_Custom_BaseParam | T2/T2 | candidate: none-known | none |
| api:LocParserRule_Custom_EnumParam | T2/T2 | candidate: none-known | none |
| api:LocParserRule_Custom_HintParam | T2/T2 | candidate: none-known | none |
| api:LocParserRule_Custom_IndexParam | T2/T2 | candidate: none-known | none |
| api:LocParserRule_Custom_NotificationParam | T2/T2 | candidate: none-known | none |
| api:LocParserRule_Custom_ResourceNameParam | T2/T2 | candidate: none-known | none |
| api:LocParserRule_Custom_StringParam | T2/T2 | candidate: none-known | none |
| api:LocalizationEditor | T2/T2 | candidate: none-known | none |
| api:LocalizationEditorPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_LocEditedTextPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_LocExportPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_LocLengthPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_LocLinkImagePlugin | T2/T2 | candidate: none-known | none |
| api:SCR_LocLinkImagePluginResult | T2/T2 | candidate: none-known | none |
| api:SCR_LocModifiedPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_LocStatusPlugin | T2/T2 | candidate: none-known | none |
| api:TranslationPlugin | T2/T2 | candidate: none-known | none |
| api:TranslationPluginConfigLocaleMatch | T2/T2 | candidate: none-known | none |
| api:TranslationPluginFields | T2/T2 | candidate: none-known | none |
| api:TranslationPluginMatchConfig | T2/T2 | candidate: none-known | none |
| api:TranslationPluginQuery | T2/T2 | candidate: none-known | none |
| api:TranslationPluginRequest | T2/T2 | candidate: none-known | none |
| api:TranslationPluginResponse | T2/T2 | candidate: none-known | none |
| api:TranslationPluginResponseMeta | T2/T2 | candidate: none-known | none |
| api:TranslationPluginResponseMetaUsage | T2/T2 | candidate: none-known | none |
| api:TranslationPluginResult | T2/T2 | candidate: none-known | none |
| api:TranslationPluginResultHolder | T2/T2 | candidate: none-known | none |
| api:TranslationPlugin_DataWrapper | T2/T2 | candidate: none-known | none |
| api:TranslationPlugin_LoadConfigUI | T2/T2 | candidate: none-known | none |
| api:TranslationRequestMeta | T2/T2 | candidate: none-known | none |

### cli-switch (5)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| cli:-build | T2/T5 | candidate: cli | none |
| cli:-savedir | T2/T5 | candidate: cli | none |
| cli:cli-switch/Build from CLI | T0/T5 | candidate: cli | none |
| cli:cli-switch/Game language and loc diagnostics | T0/T5 | candidate: cli | none |
| cli:cli-switch/Module launch and link | T0/T5 | candidate: cli | none |

### control (10)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:LocalizationEditor/control/#FilterAddButton | T2/T5 | candidate: gui-automation | none |
| ui:LocalizationEditor/control/#FilterColumnCombo | T2/T5 | candidate: gui-automation | none |
| ui:LocalizationEditor/control/#FilterOpCombo | T2/T5 | candidate: gui-automation | none |
| ui:LocalizationEditor/control/#InsertButton | T2/T5 | candidate: gui-automation | none |
| ui:LocalizationEditor/control/#InsertEdit | T2/T5 | candidate: gui-automation | none |
| ui:LocalizationEditor/control/#Maximize-Restore | T2/T5 | candidate: gui-automation | none |
| ui:LocalizationEditor/control/#Minimize-Restore | T2/T5 | candidate: gui-automation | none |
| ui:LocalizationEditor/control/#propertySearchEdit | T0/T5 | candidate: gui-automation | none |
| ui:LocalizationEditor/control/Close | T2/T5 | candidate: gui-automation | none |
| ui:LocalizationEditor/control/propertySearchEdit/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation | none |

### enum (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:ETranslationPlugin_EditedRowsMode | T2/T2 | candidate: none-known | none |
| api:ETranslationPlugin_ProcessMode | T2/T2 | candidate: none-known | none |

### enum-value (11)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:ETranslationPlugin_EditedRowsMode.PROCESS_ALL | T2/T2 | candidate: none-known | none |
| api:ETranslationPlugin_EditedRowsMode.PROCESS_EDITED_ONLY | T2/T2 | candidate: none-known | none |
| api:ETranslationPlugin_EditedRowsMode.PROCESS_UNEDITED_ONLY | T2/T2 | candidate: none-known | none |
| api:ETranslationPlugin_ProcessMode.PRODUCTION | T2/T2 | candidate: none-known | none |
| api:ETranslationPlugin_ProcessMode.SIMULATE_ERROR_403 | T2/T2 | candidate: none-known | none |
| api:ETranslationPlugin_ProcessMode.SIMULATE_ERROR_404 | T2/T2 | candidate: none-known | none |
| api:ETranslationPlugin_ProcessMode.SIMULATE_ERROR_408 | T2/T2 | candidate: none-known | none |
| api:ETranslationPlugin_ProcessMode.SIMULATE_ERROR_418 | T2/T2 | candidate: none-known | none |
| api:ETranslationPlugin_ProcessMode.SIMULATE_ERROR_500 | T2/T2 | candidate: none-known | none |
| api:ETranslationPlugin_ProcessMode.SIMULATE_ERROR_501 | T2/T2 | candidate: none-known | none |
| api:ETranslationPlugin_ProcessMode.SIMULATE_SUCCESS | T2/T2 | candidate: none-known | none |

### event (23)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:CheckLocalizationPlugin.Configure/0 | T2/T5 | candidate: net-api-handler | none |
| api:CheckLocalizationPlugin.Run/0 | T2/T5 | candidate: net-api-handler | none |
| api:LocalizationEditorPlugin.GetExportColumn/2 | T2/T5 | candidate: net-api-handler | none |
| api:LocalizationEditorPlugin.IsReadOnly/2 | T2/T5 | candidate: net-api-handler | none |
| api:LocalizationEditorPlugin.OnChange/3 | T2/T5 | candidate: net-api-handler | none |
| api:LocalizationEditorPlugin.OnExport/1 | T2/T5 | candidate: net-api-handler | none |
| api:LocalizationEditorPlugin.OnImport/2 | T2/T5 | candidate: net-api-handler | none |
| api:LocalizationEditorPlugin.OnSave/3 | T2/T5 | candidate: net-api-handler | none |
| api:LocalizationEditorPlugin.OnSelectionChanged/0 | T2/T5 | candidate: net-api-handler | none |
| api:LocalizationEditorPlugin.OnStringTableItemContextMenu/0 | T2/T5 | candidate: net-api-handler | none |
| api:TranslationPluginQuery.OnExpand/0 | T2/T5 | candidate: net-api-handler | none |
| api:TranslationPluginQuery.OnPack/0 | T2/T5 | candidate: net-api-handler | none |
| api:TranslationPluginRequest.OnExpand/0 | T2/T5 | candidate: net-api-handler | none |
| api:TranslationPluginRequest.OnPack/0 | T2/T5 | candidate: net-api-handler | none |
| api:TranslationRequestMeta.OnExpand/0 | T2/T5 | candidate: net-api-handler | none |
| api:TranslationRequestMeta.OnPack/0 | T2/T5 | candidate: net-api-handler | none |
| api:event/IsReadOnly | T0/T5 | candidate: file-format | none |
| api:event/OnChange | T0/T5 | candidate: file-format | none |
| api:event/OnExport | T0/T5 | candidate: file-format | none |
| api:event/OnImport | T0/T5 | candidate: file-format | none |
| api:event/OnSave | T0/T5 | candidate: file-format | none |
| api:event/OnSelectionChanged | T0/T5 | candidate: file-format | none |
| api:event/OnStringTableItemContextMenu | T0/T5 | candidate: file-format | none |

### file-type (7)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| file:.st | T2/T3 | candidate: file-format | [find_broken_refs.run](../tools/find_broken_refs.md) read, [find_references.run](../tools/find_references.md) read, [find_unused_resources.run](../tools/find_unused_resources.md) read, [inheritance_chain.run](../tools/inheritance_chain.md) read, [list_resources.run](../tools/list_resources.md) read, [project_index_status.run](../tools/project_index_status.md) read, [refactor_remove_unused.run](../tools/refactor_remove_unused.md) read, [resolve_guid.run](../tools/resolve_guid.md) read, [string_table.buildRuntime](../tools/string_table.md) drive, [string_table.create](../tools/string_table.md) drive, [string_table.get](../tools/string_table.md) read, [string_table.inspect](../tools/string_table.md) read, [string_table.lint](../tools/string_table.md) drive, [string_table.lookup](../tools/string_table.md) drive, [string_table.remove](../tools/string_table.md) drive, [string_table.upsert](../tools/string_table.md) drive, [ui_localization_audit.run](../tools/ui_localization_audit.md) read |
| file:file-type/.dlg Dialogue config | T0/T3 | candidate: file-format | none |
| file:file-type/.st String Table | T0/T3 | candidate: file-format | none |
| file:file-type/LocParser rule configs | T0/T3 | candidate: file-format | none |
| file:file-type/Persisted state | T0/T3 | candidate: file-format | none |
| file:file-type/Project registration | T0/T3 | candidate: file-format | none |
| file:file-type/StringTableRuntime .conf | T0/T3 | candidate: file-format | none |

### handler-action (16)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| mcp:handler-action/EMCP_WB_Localization.buildRuntime | T2/T5 | candidate: net-api-handler | [wb_localization.buildRuntime](../tools/wb_localization.md) read |
| mcp:handler-action/EMCP_WB_Localization.close | T2/T5 | candidate: net-api-handler | [wb_localization.close](../tools/wb_localization.md) read |
| mcp:handler-action/EMCP_WB_Localization.columns | T5/T5 | net-api-handler | [wb_localization.columns](../tools/wb_localization.md) drive, [wb_localization.columns](../tools/wb_localization.md) read |
| mcp:handler-action/EMCP_WB_Localization.delete | T2/T5 | candidate: net-api-handler | [wb_localization.delete](../tools/wb_localization.md) read |
| mcp:handler-action/EMCP_WB_Localization.filter | T5/T5 | net-api-handler | [wb_localization.filter](../tools/wb_localization.md) drive, [wb_localization.filter](../tools/wb_localization.md) read |
| mcp:handler-action/EMCP_WB_Localization.get | T5/T5 | net-api-handler | [wb_localization.get](../tools/wb_localization.md) drive, [wb_localization.get](../tools/wb_localization.md) read |
| mcp:handler-action/EMCP_WB_Localization.getTable | T0/T5 | candidate: net-api-handler | [wb_localization.getTable](../tools/wb_localization.md) read |
| mcp:handler-action/EMCP_WB_Localization.insert | T2/T5 | candidate: net-api-handler | [wb_localization.insert](../tools/wb_localization.md) read |
| mcp:handler-action/EMCP_WB_Localization.list | T5/T5 | net-api-handler | [wb_localization.list](../tools/wb_localization.md) drive, [wb_localization.list](../tools/wb_localization.md) read |
| mcp:handler-action/EMCP_WB_Localization.listLanguages | T0/T5 | candidate: net-api-handler | [wb_localization.listLanguages](../tools/wb_localization.md) read |
| mcp:handler-action/EMCP_WB_Localization.modify | T0/T5 | candidate: net-api-handler | [wb_localization.modify](../tools/wb_localization.md) read |
| mcp:handler-action/EMCP_WB_Localization.open | T5/T5 | net-api-handler | [wb_localization.open](../tools/wb_localization.md) drive, [wb_localization.open](../tools/wb_localization.md) read |
| mcp:handler-action/EMCP_WB_Localization.save | T5/T5 | net-api-handler | [wb_localization.save](../tools/wb_localization.md) drive, [wb_localization.save](../tools/wb_localization.md) read |
| mcp:handler-action/EMCP_WB_Localization.selection | T5/T5 | net-api-handler | [wb_localization.selection](../tools/wb_localization.md) drive, [wb_localization.selection](../tools/wb_localization.md) read |
| mcp:handler-action/EMCP_WB_Localization.set | T5/T5 | net-api-handler | [wb_localization.set](../tools/wb_localization.md) drive, [wb_localization.set](../tools/wb_localization.md) read |
| mcp:handler-action/EMCP_WB_Localization.status | T5/T5 | net-api-handler | [wb_localization.status](../tools/wb_localization.md) drive, [wb_localization.status](../tools/wb_localization.md) read |

### link-format (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| link:enfusion://LocalizationEditor | T1/T5 | candidate: cli | [wb_link.build](../tools/wb_link.md) read, [wb_link.open](../tools/wb_link.md) drive, [wb_link.parse](../tools/wb_link.md) read |
| link:https://community.bistudio.com/wiki/Arma_Reforger:String_Editor | T2/T5 | candidate: file-format | none |

### mcp-action (16)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| mcp:action/wb_localization.buildRuntime | T3/T5 | candidate: none-known | [wb_localization.buildRuntime](../tools/wb_localization.md) drive |
| mcp:action/wb_localization.close | T3/T5 | candidate: none-known | [wb_localization.close](../tools/wb_localization.md) drive |
| mcp:action/wb_localization.columns | T5/T5 | net-api-handler | [wb_localization.columns](../tools/wb_localization.md) drive |
| mcp:action/wb_localization.delete | T5/T5 | net-api-handler | [wb_localization.delete](../tools/wb_localization.md) drive |
| mcp:action/wb_localization.filter | T5/T5 | net-api-handler | [wb_localization.filter](../tools/wb_localization.md) drive |
| mcp:action/wb_localization.get | T5/T5 | net-api-handler | [wb_localization.get](../tools/wb_localization.md) drive |
| mcp:action/wb_localization.getTable | T5/T5 | net-api-handler | [wb_localization.getTable](../tools/wb_localization.md) drive |
| mcp:action/wb_localization.insert | T5/T5 | net-api-handler | [wb_localization.insert](../tools/wb_localization.md) drive |
| mcp:action/wb_localization.list | T5/T5 | net-api-handler | [wb_localization.list](../tools/wb_localization.md) drive |
| mcp:action/wb_localization.listLanguages | T5/T5 | net-api-handler | [wb_localization.listLanguages](../tools/wb_localization.md) drive |
| mcp:action/wb_localization.modify | T5/T5 | net-api-handler | [wb_localization.modify](../tools/wb_localization.md) drive |
| mcp:action/wb_localization.open | T5/T5 | net-api-handler | [wb_localization.open](../tools/wb_localization.md) drive |
| mcp:action/wb_localization.save | T5/T5 | net-api-handler | [wb_localization.save](../tools/wb_localization.md) drive |
| mcp:action/wb_localization.selection | T5/T5 | net-api-handler | [wb_localization.selection](../tools/wb_localization.md) drive |
| mcp:action/wb_localization.set | T5/T5 | net-api-handler | [wb_localization.set](../tools/wb_localization.md) drive |
| mcp:action/wb_localization.status | T5/T5 | net-api-handler | [wb_localization.status](../tools/wb_localization.md) drive |

### mcp-tool (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| mcp:tool/wb_localization | T2/T2 | candidate: none-known | none |

### menu (9)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:LocalizationEditor/menu/Columns | T1/T3 | candidate: gui-automation | none |
| ui:LocalizationEditor/menu/Edit | T2/T3 | candidate: gui-automation | none |
| ui:LocalizationEditor/menu/File | T2/T3 | candidate: gui-automation | none |
| ui:LocalizationEditor/menu/Help | T2/T3 | candidate: gui-automation | none |
| ui:LocalizationEditor/menu/Plugins | T2/T3 | candidate: gui-automation | none |
| ui:LocalizationEditor/menu/Plugins/Settings | T2/T3 | candidate: gui-automation | none |
| ui:LocalizationEditor/menu/Table | T2/T3 | candidate: gui-automation | none |
| ui:LocalizationEditor/menu/Window | T2/T3 | candidate: gui-automation | none |
| ui:LocalizationEditor/menu/Window/Layout | T2/T3 | candidate: gui-automation | none |

### menu-item (45)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:LocalizationEditor/menu-item/Align Nodes (horizontal, vertical) | T0/T5 | candidate: gui-automation | none |
| ui:LocalizationEditor/menu-item/Build Runtime Table (Ctrl+B) | T0/T5 | candidate: cli, execute-action | none |
| ui:LocalizationEditor/menu-item/Columns menu | T0/T5 | candidate: gui-automation | none |
| ui:LocalizationEditor/menu-item/Delete Item | T0/T5 | candidate: net-api-handler | none |
| ui:LocalizationEditor/menu-item/Edit/Redo | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Edit/Undo | T3/T5 | candidate: execute-action, gui-automation | [wb_module.action](../tools/wb_module.md) drive |
| ui:LocalizationEditor/menu-item/Exit | T0/T2 | candidate: net-api-handler | none |
| ui:LocalizationEditor/menu-item/Export (GraphML) | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Export Table (Ctrl+Shift+E) | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/File/Exit | T2/T2 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/File/New | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/File/Open | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/File/Save | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Graph context menu | T0/T5 | candidate: file-format, gui-automation | none |
| ui:LocalizationEditor/menu-item/Help/View Help | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Import FDX | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Import Table (Ctrl+Shift+I) | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Insert Item (Ctrl+I) | T0/T5 | candidate: net-api-handler | none |
| ui:LocalizationEditor/menu-item/Localization Language selector | T0/T5 | candidate: gui-automation | none |
| ui:LocalizationEditor/menu-item/New (Ctrl+N) | T0/T5 | candidate: execute-action, file-format | none |
| ui:LocalizationEditor/menu-item/Open | T0/T5 | candidate: net-api-handler | none |
| ui:LocalizationEditor/menu-item/Plugins/Check length | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Plugins/Check localization in UI | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Plugins/Generate Image Links | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Plugins/Move edited text to source | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Plugins/Settings/Check localization in UI | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Plugins/Settings/Clear All Settings | T2/T2 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Plugins/Settings/Modified Localisation Plugin | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Plugins/Settings/Reload WB Scripts | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Plugins/Settings/Translation plugin | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Plugins/Temporarily unlock selected string(s) | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Plugins/Translation plugin | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Row context menu | T0/T5 | candidate: gui-automation | none |
| ui:LocalizationEditor/menu-item/Save (Ctrl+S) | T0/T5 | candidate: net-api-handler | none |
| ui:LocalizationEditor/menu-item/Start%2FStop Preview, Step Preview, Preview From Here | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Table/Build Runtime Table | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Table/Delete Item | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Table/Export Table | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Table/Import Table | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:LocalizationEditor/menu-item/Table/Insert Item | T2/T5 | candidate: execute-action, gui-automation | none |

5 more: wb_census find with module=LocalizationEditor kind=menu-item.

### method (92)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:CheckLocalizationPlugin.AddTranslationsToTable/2 | T2/T5 | candidate: net-api-handler | none |
| api:CheckLocalizationPlugin.ButtonClose/0 | T2/T5 | candidate: net-api-handler | none |
| api:CheckLocalizationPlugin.GetNonLocalizedReportEntries/3 | T2/T5 | candidate: net-api-handler | none |
| api:CheckLocalizationPlugin.GetNonLocalizedReports/1 | T2/T5 | candidate: net-api-handler | none |
| api:CheckLocalizationPlugin.GetTextId/2 | T2/T5 | candidate: net-api-handler | none |
| api:LocParserManager.ProcessContainer/6 | T2/T5 | candidate: net-api-handler | none |
| api:LocParserManager.UpdateFromTemplate/2 | T2/T5 | candidate: net-api-handler | none |
| api:LocParserManager.UpdateItem/2 | T2/T5 | candidate: net-api-handler | none |
| api:LocParserRule.Evaluate/3 | T2/T5 | candidate: net-api-handler | none |
| api:LocParserRule.GetID/4 | T2/T5 | candidate: net-api-handler | none |
| api:LocParserRule.InitRule/1 | T2/T5 | candidate: net-api-handler | none |
| api:LocParserRule.Localize/5 | T2/T5 | candidate: net-api-handler | none |
| api:LocParserRule_Custom.Evaluate/3 | T2/T5 | candidate: net-api-handler | none |
| api:LocParserRule_Custom.GetID/4 | T2/T5 | candidate: net-api-handler | none |
| api:LocParserRule_Custom.LocParserRule_Custom/0 | T2/T5 | candidate: net-api-handler | none |
| api:LocParserRule_Custom.RemoveExpression/1 | T2/T5 | candidate: net-api-handler | none |
| api:LocParserRule_Custom_BaseParam.GetArguments/4 | T2/T5 | candidate: net-api-handler | none |
| api:LocParserRule_Custom_BaseParam.GetParam/2 | T2/T5 | candidate: net-api-handler | none |
| api:LocParserRule_Custom_EnumParam.GetParam/2 | T2/T5 | candidate: net-api-handler | none |
| api:LocParserRule_Custom_HintParam.GetParam/2 | T2/T5 | candidate: net-api-handler | none |
| api:LocParserRule_Custom_IndexParam.GetParam/2 | T2/T5 | candidate: net-api-handler | none |
| api:LocParserRule_Custom_NotificationParam.GetParam/2 | T2/T5 | candidate: net-api-handler | none |
| api:LocParserRule_Custom_ResourceNameParam.GetParam/2 | T2/T5 | candidate: net-api-handler | none |
| api:LocParserRule_Custom_StringParam.GetParam/2 | T2/T5 | candidate: net-api-handler | none |
| api:LocalizationEditor.AddUserFilter/2 | T3/T5 | candidate: net-api-handler | [wb_localization.filter](../tools/wb_localization.md) drive |
| api:LocalizationEditor.BeginModify/1 | T5/T5 | net-api-handler | [wb_localization.delete](../tools/wb_localization.md) drive, [wb_localization.insert](../tools/wb_localization.md) drive, [wb_localization.modify](../tools/wb_localization.md) drive, [wb_localization.set](../tools/wb_localization.md) drive |
| api:LocalizationEditor.DeleteItem/1 | T5/T5 | net-api-handler | [wb_localization.delete](../tools/wb_localization.md) drive, [wb_localization.insert](../tools/wb_localization.md) drive |
| api:LocalizationEditor.EndModify/0 | T5/T5 | net-api-handler | [wb_localization.delete](../tools/wb_localization.md) drive, [wb_localization.insert](../tools/wb_localization.md) drive, [wb_localization.modify](../tools/wb_localization.md) drive, [wb_localization.set](../tools/wb_localization.md) drive |
| api:LocalizationEditor.GetFilteredRows/1 | T3/T5 | candidate: net-api-handler | [wb_localization.selection](../tools/wb_localization.md) read |
| api:LocalizationEditor.GetSelectedRows/1 | T3/T5 | candidate: net-api-handler | [wb_localization.selection](../tools/wb_localization.md) read |
| api:LocalizationEditor.GetTable/0 | T5/T5 | net-api-handler | [wb_localization.columns](../tools/wb_localization.md) drive, [wb_localization.delete](../tools/wb_localization.md) drive, [wb_localization.filter](../tools/wb_localization.md) drive, [wb_localization.get](../tools/wb_localization.md) drive, [wb_localization.getTable](../tools/wb_localization.md) drive, [wb_localization.insert](../tools/wb_localization.md) drive, [wb_localization.list](../tools/wb_localization.md) drive, [wb_localization.listLanguages](../tools/wb_localization.md) drive, [wb_localization.modify](../tools/wb_localization.md) drive, [wb_localization.open](../tools/wb_localization.md) drive, [wb_localization.save](../tools/wb_localization.md) drive, [wb_localization.selection](../tools/wb_localization.md) drive, [wb_localization.set](../tools/wb_localization.md) drive, [wb_localization.status](../tools/wb_localization.md) drive |
| api:LocalizationEditor.InsertItem/3 | T5/T5 | net-api-handler | [wb_localization.insert](../tools/wb_localization.md) drive |
| api:LocalizationEditor.ModifyProperty/3 | T5/T5 | net-api-handler | [wb_localization.insert](../tools/wb_localization.md) drive, [wb_localization.modify](../tools/wb_localization.md) drive, [wb_localization.set](../tools/wb_localization.md) drive |
| api:LocalizationEditor.RefreshUI/0 | T3/T5 | candidate: net-api-handler | [wb_localization.filter](../tools/wb_localization.md) drive |
| api:SCR_LocEditedTextPlugin.Run/0 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_LocExportPlugin.GetExportColumn/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_LocLengthPlugin.Run/0 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_LocLinkImagePlugin.ButtonClose/0 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_LocLinkImagePlugin.ButtonRun/0 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_LocLinkImagePlugin.OnChange/3 | T2/T5 | candidate: net-api-handler | none |

52 more: wb_census find with module=LocalizationEditor kind=method.

### module (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:LocalizationEditor/module/LocalizationEditor | T1/T5 | candidate: builtin-net-handler, net-api-handler | [wb_localization.open](../tools/wb_localization.md) drive |
| ui:LocalizationEditor/module/Module registration | T1/T5 | candidate: net-api-handler | none |

### option (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:LocalizationEditor/option/Editor options (DialogueEditorOptions) | T0/T5 | candidate: gui-automation | none |

### panel (11)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:LocalizationEditor/panel/#FilterGroup | T2/T3 | candidate: gui-automation | none |
| ui:LocalizationEditor/panel/#FiltersFrame | T2/T3 | candidate: gui-automation | none |
| ui:LocalizationEditor/panel/#InsertGroup | T2/T3 | candidate: gui-automation | none |
| ui:LocalizationEditor/panel/@QStatusBar.1 | T0/T3 | candidate: gui-automation | none |
| ui:LocalizationEditor/panel/Details property grid (itemProperty) | T0/T3 | candidate: net-api-handler | none |
| ui:LocalizationEditor/panel/Filter builder | T0/T3 | candidate: net-api-handler | none |
| ui:LocalizationEditor/panel/Grid (stringTableView) and row selection | T0/T3 | candidate: gui-automation, net-api-handler | none |
| ui:LocalizationEditor/panel/Node Presets dock | T0/T3 | candidate: gui-automation | none |
| ui:LocalizationEditor/panel/Preview dock and Debug Controls dock | T0/T3 | candidate: gui-automation | none |
| ui:LocalizationEditor/panel/Scene Properties dock | T0/T3 | candidate: net-api-handler | none |
| ui:LocalizationEditor/panel/Validation Errors dock | T0/T3 | candidate: gui-automation | none |

### plugin (17)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:CheckLocalizationPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:LocExportPlugin | T0/T5 | candidate: plugin-run | none |
| plugin:SCR_LocEditedTextPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_LocExportPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_LocLengthPlugin | T2/T5 | candidate: plugin-run | [wb_plugin.run](../tools/wb_plugin.md) drive |
| plugin:SCR_LocLinkImagePlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_LocModifiedPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_LocStatusPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:TranslationPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:plugin/Check length | T0/T5 | candidate: plugin-run | none |
| plugin:plugin/Check localization in UI (Ctrl+Shift+A) | T0/T5 | candidate: plugin-run | none |
| plugin:plugin/Generate Image Links | T0/T5 | candidate: gui-automation | none |
| plugin:plugin/Localise Selected Files (Ctrl+Alt+L, Resource Manager) | T0/T5 | candidate: plugin-run | none |
| plugin:plugin/Modified Localisation Plugin | T0/T5 | candidate: plugin-run | none |
| plugin:plugin/Move edited text to source | T0/T5 | candidate: plugin-run | none |
| plugin:plugin/Temporarily unlock selected string(s) (Ctrl+E) | T0/T5 | candidate: plugin-run | none |
| plugin:plugin/Translation plugin (Ctrl+Shift+T) | T0/T5 | candidate: gui-automation | none |

### plugin-button (8)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:CheckLocalizationPlugin#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_LocLinkImagePlugin#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_LocLinkImagePlugin#button:ButtonRun | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_LocModifiedPlugin#button:OkButton | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_LocStatusPlugin#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:TranslationPlugin#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:TranslationPlugin#button:ButtonLoadConfig | T2/T5 | candidate: plugin-run | none |
| plugin:TranslationPlugin#button:ButtonValidateClose | T2/T5 | candidate: plugin-run | none |

### plugin-setting (17)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:CheckLocalizationPlugin#attr:m_bAddToLocalizationFile | T2/T4 | candidate: plugin-run | none |
| plugin:CheckLocalizationPlugin#attr:m_sIdPrefix | T2/T4 | candidate: plugin-run | none |
| plugin:CheckLocalizationPlugin#attr:m_sSourceField | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_LocLinkImagePlugin#attr:m_sExtension | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_LocLinkImagePlugin#attr:m_sPath | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_LocModifiedPlugin#attr:UserName | T2/T4 | candidate: plugin-run | none |
| plugin:TranslationPlugin#attr:m_MatchConfig | T2/T4 | candidate: plugin-run | none |
| plugin:TranslationPlugin#attr:m_bDisableLocalesGrouping | T2/T4 | candidate: plugin-run | none |
| plugin:TranslationPlugin#attr:m_bDisplayAdvancedStatsOnSuccess | T2/T4 | candidate: plugin-run | none |
| plugin:TranslationPlugin#attr:m_bLogChanges | T2/T4 | candidate: plugin-run | none |
| plugin:TranslationPlugin#attr:m_bLogNetwork | T2/T4 | candidate: plugin-run | none |
| plugin:TranslationPlugin#attr:m_bOverwriteExistingTranslations | T2/T4 | candidate: plugin-run | none |
| plugin:TranslationPlugin#attr:m_bSetEditedAsOriginal | T2/T4 | candidate: plugin-run | none |
| plugin:TranslationPlugin#attr:m_eEditedEntriesMode | T2/T4 | candidate: plugin-run | none |
| plugin:TranslationPlugin#attr:m_eProcessMode | T2/T4 | candidate: plugin-run | none |
| plugin:TranslationPlugin#attr:m_sServerToken | T2/T4 | candidate: plugin-run | none |
| plugin:TranslationPlugin#attr:m_sServerURL | T2/T4 | candidate: plugin-run | none |

### property (12)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:property/ActorGender, Terminology | T0/T2 | candidate: file-format, net-api-handler | none |
| schema:property/Comment, DevNote, Repro | T0/T2 | candidate: file-format, net-api-handler | none |
| schema:property/Id | T0/T2 | candidate: file-format, net-api-handler | none |
| schema:property/Item class | T0/T2 | candidate: file-format | none |
| schema:property/Labels | T0/T2 | candidate: file-format, net-api-handler | none |
| schema:property/LocalizedString type and LocaleEditBox widget | T0/T2 | candidate: file-format | none |
| schema:property/Modified, Author, LastChanged | T0/T2 | candidate: file-format, net-api-handler | none |
| schema:property/NonTranslatable, Hidden, MaxLength | T0/T2 | candidate: file-format, net-api-handler | none |
| schema:property/SourceFile, ImageLink | T0/T2 | candidate: file-format, net-api-handler | none |
| schema:property/Status | T0/T2 | candidate: file-format, net-api-handler | none |
| schema:property/Target_<locale> translations (12) | T0/T2 | candidate: file-format, net-api-handler | none |
| schema:property/Target_en_us, Target_en_us_edited | T0/T2 | candidate: file-format, net-api-handler | none |

### property-group (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:LocalizationEditor/property-group/#itemProperty | T0/T3 | candidate: gui-automation | none |

### region (5)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:LocalizationEditor/region/#SystemMenuBar | T0/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/region/#qt_splithandle_ | T0/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/region/@QMenuBar.1 | T0/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/region/@QStatusBar.1/@QSizeGrip.1 | T0/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/region/@TitleBar.1 | T0/T2 | candidate: gui-automation | none |

### setting-key (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| setting:String Editor/legacyOptionsLoaded | T0/T3 | candidate: file-format | none |

### shortcut (20)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:LocalizationEditor/shortcut/File/Save | T1/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/shortcut/String Editor Plugins/Check length | T2/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/shortcut/String Editor Plugins/Check localization in UI | T2/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/shortcut/String Editor Plugins/Generate Image Links | T2/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/shortcut/String Editor Plugins/Move edited text to source | T2/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/shortcut/String Editor Plugins/Normal-Aligned Floaters Finder | T2/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/shortcut/String Editor Plugins/Temporarily unlock selected string(s) | T2/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/shortcut/String Editor/Build Runtime Table | T2/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/shortcut/String Editor/Delete Item | T2/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/shortcut/String Editor/Exit | T2/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/shortcut/String Editor/Export Table | T2/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/shortcut/String Editor/Find | T2/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/shortcut/String Editor/Find Next | T2/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/shortcut/String Editor/Find Prev | T2/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/shortcut/String Editor/Import Table | T2/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/shortcut/String Editor/Insert Item | T2/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/shortcut/String Editor/New | T2/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/shortcut/String Editor/Open | T2/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/shortcut/String Editor/Save | T2/T2 | candidate: gui-automation | none |
| ui:LocalizationEditor/shortcut/Table/Build Runtime Table | T1/T2 | candidate: gui-automation | none |

### static-method (8)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:LocParserManager.Run/4 | T2/T5 | candidate: net-api-handler | none |
| api:TranslationPlugin.AreLocalesEqual/2 | T2/T5 | candidate: net-api-handler | none |
| api:TranslationPlugin.FormatDurationMs/1 | T2/T5 | candidate: net-api-handler | none |
| api:TranslationPlugin.GetTranslationFromLocale/2 | T2/T5 | candidate: net-api-handler | none |
| api:TranslationPlugin.PrintDialog/3 | T2/T5 | candidate: net-api-handler | none |
| api:TranslationPlugin.PrintFormatDialog/6 | T2/T5 | candidate: net-api-handler | none |
| api:TranslationPlugin.SanitizeToken/1 | T2/T5 | candidate: net-api-handler | none |
| api:TranslationPlugin.SplitURL/4 | T2/T5 | candidate: net-api-handler | none |

### status-item (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:LocalizationEditor/status-item/@QStatusBar.1/Version 1.8.0.13 (production) | T2/T2 | candidate: gui-automation | none |

### window (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:LocalizationEditor/window/#LocalizationEditorMain | T1/T3 | candidate: gui-automation | none |

## Below target (279)

- T0 to T2: 18
- T0 to T3: 16
- T0 to T5: 45
- T1 to T2: 2
- T1 to T3: 2
- T1 to T5: 3
- T2 to T3: 12
- T2 to T4: 17
- T2 to T5: 157
- T3 to T5: 7

| id | tier | path |
| --- | --- | --- |
| api:CheckLocalizationPlugin.AddTranslationsToTable/2 | T2/T5 | candidate: net-api-handler |
| api:CheckLocalizationPlugin.ButtonClose/0 | T2/T5 | candidate: net-api-handler |
| api:CheckLocalizationPlugin.Configure/0 | T2/T5 | candidate: net-api-handler |
| api:CheckLocalizationPlugin.GetNonLocalizedReportEntries/3 | T2/T5 | candidate: net-api-handler |
| api:CheckLocalizationPlugin.GetNonLocalizedReports/1 | T2/T5 | candidate: net-api-handler |
| api:CheckLocalizationPlugin.GetTextId/2 | T2/T5 | candidate: net-api-handler |
| api:CheckLocalizationPlugin.Run/0 | T2/T5 | candidate: net-api-handler |
| api:LocParserManager.ProcessContainer/6 | T2/T5 | candidate: net-api-handler |
| api:LocParserManager.Run/4 | T2/T5 | candidate: net-api-handler |
| api:LocParserManager.UpdateFromTemplate/2 | T2/T5 | candidate: net-api-handler |
| api:LocParserManager.UpdateItem/2 | T2/T5 | candidate: net-api-handler |
| api:LocParserRule.Evaluate/3 | T2/T5 | candidate: net-api-handler |
| api:LocParserRule.GetID/4 | T2/T5 | candidate: net-api-handler |
| api:LocParserRule.InitRule/1 | T2/T5 | candidate: net-api-handler |
| api:LocParserRule.Localize/5 | T2/T5 | candidate: net-api-handler |
| api:LocParserRule_Custom.Evaluate/3 | T2/T5 | candidate: net-api-handler |
| api:LocParserRule_Custom.GetID/4 | T2/T5 | candidate: net-api-handler |
| api:LocParserRule_Custom.LocParserRule_Custom/0 | T2/T5 | candidate: net-api-handler |
| api:LocParserRule_Custom.RemoveExpression/1 | T2/T5 | candidate: net-api-handler |
| api:LocParserRule_Custom_BaseParam.GetArguments/4 | T2/T5 | candidate: net-api-handler |
| api:LocParserRule_Custom_BaseParam.GetParam/2 | T2/T5 | candidate: net-api-handler |
| api:LocParserRule_Custom_EnumParam.GetParam/2 | T2/T5 | candidate: net-api-handler |
| api:LocParserRule_Custom_HintParam.GetParam/2 | T2/T5 | candidate: net-api-handler |
| api:LocParserRule_Custom_IndexParam.GetParam/2 | T2/T5 | candidate: net-api-handler |
| api:LocParserRule_Custom_NotificationParam.GetParam/2 | T2/T5 | candidate: net-api-handler |
| api:LocParserRule_Custom_ResourceNameParam.GetParam/2 | T2/T5 | candidate: net-api-handler |
| api:LocParserRule_Custom_StringParam.GetParam/2 | T2/T5 | candidate: net-api-handler |
| api:LocalizationEditor.AddUserFilter/2 | T3/T5 | candidate: net-api-handler |
| api:LocalizationEditor.GetFilteredRows/1 | T3/T5 | candidate: net-api-handler |
| api:LocalizationEditor.GetSelectedRows/1 | T3/T5 | candidate: net-api-handler |
| api:LocalizationEditor.RefreshUI/0 | T3/T5 | candidate: net-api-handler |
| api:LocalizationEditorPlugin.GetExportColumn/2 | T2/T5 | candidate: net-api-handler |
| api:LocalizationEditorPlugin.IsReadOnly/2 | T2/T5 | candidate: net-api-handler |
| api:LocalizationEditorPlugin.OnChange/3 | T2/T5 | candidate: net-api-handler |
| api:LocalizationEditorPlugin.OnExport/1 | T2/T5 | candidate: net-api-handler |
| api:LocalizationEditorPlugin.OnImport/2 | T2/T5 | candidate: net-api-handler |
| api:LocalizationEditorPlugin.OnSave/3 | T2/T5 | candidate: net-api-handler |
| api:LocalizationEditorPlugin.OnSelectionChanged/0 | T2/T5 | candidate: net-api-handler |
| api:LocalizationEditorPlugin.OnStringTableItemContextMenu/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_LocEditedTextPlugin.Run/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_LocExportPlugin.GetExportColumn/2 | T2/T5 | candidate: net-api-handler |
| api:SCR_LocLengthPlugin.Run/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_LocLinkImagePlugin.ButtonClose/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_LocLinkImagePlugin.ButtonRun/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_LocLinkImagePlugin.OnChange/3 | T2/T5 | candidate: net-api-handler |
| api:SCR_LocLinkImagePlugin.Run/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_LocLinkImagePlugin.UpdateItem/2 | T2/T5 | candidate: net-api-handler |
| api:SCR_LocLinkImagePluginResult.ButtonClose/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_LocModifiedPlugin.Configure/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_LocModifiedPlugin.GetUserName/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_LocModifiedPlugin.OkButton/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_LocModifiedPlugin.OnChange/3 | T2/T5 | candidate: net-api-handler |
| api:SCR_LocModifiedPlugin.OnImport/2 | T2/T5 | candidate: net-api-handler |
| api:SCR_LocStatusPlugin.ButtonClose/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_LocStatusPlugin.IsReadOnly/2 | T2/T5 | candidate: net-api-handler |
| api:SCR_LocStatusPlugin.OnChange/3 | T2/T5 | candidate: net-api-handler |
| api:SCR_LocStatusPlugin.OnSelectionChanged/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_LocStatusPlugin.ResetStatus/3 | T2/T5 | candidate: net-api-handler |
| api:SCR_LocStatusPlugin.Run/0 | T2/T5 | candidate: net-api-handler |
| api:TranslationPlugin.ApplyTranslations/2 | T2/T5 | candidate: net-api-handler |

219 more: wb_census find with module=LocalizationEditor.

## Dispositions (17)

| id | kind | why | evidence |
| --- | --- | --- | --- |
| api:SCR_LocEditedTextPlugin.Run/0 | blocked | blocked:P-W6-05 until this class passes [ledger work_item W3] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| api:SCR_LocLengthPlugin.Run/0 | blocked | blocked:P-W6-05 until this class passes [ledger work_item W3] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| api:SCR_LocStatusPlugin.Run/0 | blocked | blocked:P-W6-05 until this class passes [ledger work_item W3] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:cli-switch/Build from CLI | blocked | blocked:P-W6-09 (Workbench launch switch; unmeasured headless) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:cli-switch/Game language and loc diagnostics | blocked | blocked:P-W6-09 (Workbench launch switch; unmeasured headless) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:cli-switch/Module launch and link | blocked | blocked:P-W6-09 (Workbench launch switch; unmeasured headless) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| file:file-type/.dlg Dialogue config | blocked | Only the executable holds the .dlg extension; whether the Dialogue Editor is reachable in this build and whether anything consumes .dlg is P-U23. | EV-s001-003 |
| plugin:SCR_LocEditedTextPlugin | blocked | blocked:P-W6-05 until this class passes its run probe (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:SCR_LocLengthPlugin | blocked | blocked:P-W6-05 until this class passes its run probe (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:SCR_LocStatusPlugin | blocked | blocked:P-W6-05 until this class passes its run probe (DEC-087 ruling 3) | EV-P6-BK2-003 |
| ui:LocalizationEditor/menu-item/File/Exit | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:LocalizationEditor/menu-item/Plugins/Check length | blocked | blocked:P-W6-05 until this class passes its run probe [ledger work_item W3] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| ui:LocalizationEditor/menu-item/Plugins/Move edited text to source | blocked | blocked:P-W6-05 until this class passes its run probe [ledger work_item W3] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| ui:LocalizationEditor/menu-item/Plugins/Settings/Clear All Settings | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:LocalizationEditor/menu-item/Plugins/Temporarily unlock selected string(s) | blocked | blocked:P-W6-05 until this class passes its run probe [ledger work_item W3] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| ui:LocalizationEditor/menu-item/Window/Reset Default Layouts | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:LocalizationEditor/shortcut/String Editor/Exit | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
