# Census: ScriptEditor

1134 rows (23 aggregate excluded).

## What it is

Module ScriptEditor: api 316, cli 10, file 3, link 3, mcp 32, net 15, plugin 241, setting 30, ui 484. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- class EMCP_WB_Common (api:EMCP_WB_Common): FindEntityByName (linear scan), strict ParseInt/ParseFloat/ParseVectorString, VectorToString, JsonEscape
- class SCR_AiScriptGeneratorPlugin (api:SCR_AiScriptGeneratorPlugin)
- class SCR_AiScriptGenerator_Class (api:SCR_AiScriptGenerator_Class)
- class SCR_AiScriptGenerator_ClassGeneratorBase (api:SCR_AiScriptGenerator_ClassGeneratorBase)
- class SCR_AiScriptGenerator_OutputFormatBuffer (api:SCR_AiScriptGenerator_OutputFormatBuffer)
- class SCR_AiScriptGenerator_Parser (api:SCR_AiScriptGenerator_Parser)
- class SCR_AiScriptGenerator_SendGoalMessageGenerator (api:SCR_AiScriptGenerator_SendGoalMessageGenerator)
- class SCR_AiScriptGenerator_SendInfoMessageGenerator (api:SCR_AiScriptGenerator_SendInfoMessageGenerator)
- class SCR_AiScriptGenerator_SendOrderGenerator (api:SCR_AiScriptGenerator_SendOrderGenerator)
- class SCR_AiScriptGenerator_Variable (api:SCR_AiScriptGenerator_Variable)
- class SCR_AutocompletePlugin (api:SCR_AutocompletePlugin): This plugin allows for autocompletion for common structure / code excerpts and boilerplate code.
- class SCR_AutocompletePlugin_AttributeData (api:SCR_AutocompletePlugin_AttributeData)
- ... 105 more

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| api | 50 | 0 | 259 | 0 | 0 | 7 | 316 |
| cli | 9 | 0 | 1 | 0 | 0 | 0 | 10 |
| file | 2 | 0 | 1 | 0 | 0 | 0 | 3 |
| link | 1 | 1 | 1 | 0 | 0 | 0 | 3 |
| mcp | 7 | 0 | 6 | 2 | 0 | 17 | 32 |
| net | 15 | 0 | 0 | 0 | 0 | 0 | 15 |
| plugin | 145 | 0 | 96 | 0 | 0 | 0 | 241 |
| setting | 30 | 0 | 0 | 0 | 0 | 0 | 30 |
| ui | 147 | 99 | 220 | 3 | 0 | 15 | 484 |

## By kind

- attribute: 26
- class: 44
- cli-switch: 10
- control: 93
- dialog: 4
- dock: 15
- enum: 1
- enum-value: 14
- file-type: 3
- handler-action: 14
- link-format: 3
- mcp-action: 14
- mcp-tool: 4
- menu: 12
- menu-item: 141
- method: 193
- module: 13
- net-function: 6
- net-handler: 9
- option: 9
- panel: 41
- plugin: 156
- plugin-button: 11
- plugin-setting: 74
- region: 18
- setting-key: 30
- shortcut: 83
- static-method: 38
- status-item: 1
- tab: 28
- tool: 19
- toolbar: 1
- toolbar-button: 5
- window: 1

## By risk

- destructive: 6
- mutating: 822
- safe: 306

## Rows by kind

### attribute (26)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:SCR_AutocompletePlugin_AttributeData#attr:m_bEnabled | T2/T2 | candidate: net-api-handler | none |
| api:SCR_AutocompletePlugin_AttributeData#attr:m_sPrefix | T2/T2 | candidate: net-api-handler | none |
| api:SCR_AutocompletePlugin_AttributeData#attr:m_sType | T2/T2 | candidate: net-api-handler | none |
| api:SCR_AutocompletePlugin_AttributeData#attr:m_sValue | T2/T2 | candidate: net-api-handler | none |
| api:SCR_AutocompletePlugin_KeywordData#attr:m_bEnabled | T2/T2 | candidate: net-api-handler | none |
| api:SCR_AutocompletePlugin_KeywordData#attr:m_sKeyword | T2/T2 | candidate: net-api-handler | none |
| api:SCR_AutocompletePlugin_KeywordData#attr:m_sValue | T2/T2 | candidate: net-api-handler | none |
| api:SCR_BasicCodeFormatterSpellCheckConfig#attr:m_aEntries | T2/T2 | candidate: net-api-handler | none |
| api:SCR_BasicCodeFormatterSpellCheckConfig_ForbiddenWordEntry#attr:m_bEnabled | T2/T2 | candidate: net-api-handler | none |
| api:SCR_BasicCodeFormatterSpellCheckConfig_ForbiddenWordEntry#attr:m_sComment | T2/T2 | candidate: net-api-handler | none |
| api:SCR_BasicCodeFormatterSpellCheckConfig_ForbiddenWordEntry#attr:m_sCorrection | T2/T2 | candidate: net-api-handler | none |
| api:SCR_BasicCodeFormatterSpellCheckConfig_ForbiddenWordEntry#attr:m_sMistake | T2/T2 | candidate: net-api-handler | none |
| api:SCR_ClassRenamingParam#attr:m_bEnabled | T2/T2 | candidate: net-api-handler | none |
| api:SCR_ClassRenamingParam#attr:m_sFrom | T2/T2 | candidate: net-api-handler | none |
| api:SCR_ClassRenamingParam#attr:m_sTo | T2/T2 | candidate: net-api-handler | none |
| api:SCR_NewScriptPlugin_AbsoluteUI#attr:m_iAddon | T2/T2 | candidate: net-api-handler | none |
| api:SCR_NewScriptPlugin_AbsoluteUI#attr:m_sDestinationDirectory | T2/T2 | candidate: net-api-handler | none |
| api:SCR_NewScriptPlugin_AbsoluteUI#attr:m_sFileName | T2/T2 | candidate: net-api-handler | none |
| api:SCR_NewScriptPlugin_RelativeUI#attr:m_iAddon | T2/T2 | candidate: net-api-handler | none |
| api:SCR_NewScriptPlugin_RelativeUI#attr:m_sDestinationDirectory | T2/T2 | candidate: net-api-handler | none |
| api:SCR_NewScriptPlugin_RelativeUI#attr:m_sFileName | T2/T2 | candidate: net-api-handler | none |
| api:SCR_ScriptTemplateConfig#attr:m_aEntries | T2/T2 | candidate: net-api-handler | none |
| api:SCR_ScriptTemplateConfigEntry#attr:m_eType | T2/T2 | candidate: net-api-handler | none |
| api:SCR_ScriptTemplateConfigEntry#attr:m_sDefaultParentName | T2/T2 | candidate: net-api-handler | none |
| api:SCR_ScriptTemplateConfigEntry#attr:m_sSuffix | T2/T2 | candidate: net-api-handler | none |
| api:SCR_ScriptTemplateConfigEntry#attr:m_sTemplate | T2/T2 | candidate: net-api-handler | none |

### class (44)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:EMCP_WB_Common | T0/T2 | candidate: none-known | none |
| api:SCR_AiScriptGeneratorPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_AiScriptGenerator_Class | T2/T2 | candidate: none-known | none |
| api:SCR_AiScriptGenerator_ClassGeneratorBase | T2/T2 | candidate: none-known | none |
| api:SCR_AiScriptGenerator_OutputFormatBuffer | T2/T2 | candidate: none-known | none |
| api:SCR_AiScriptGenerator_Parser | T2/T2 | candidate: none-known | none |
| api:SCR_AiScriptGenerator_SendGoalMessageGenerator | T2/T2 | candidate: none-known | none |
| api:SCR_AiScriptGenerator_SendInfoMessageGenerator | T2/T2 | candidate: none-known | none |
| api:SCR_AiScriptGenerator_SendOrderGenerator | T2/T2 | candidate: none-known | none |
| api:SCR_AiScriptGenerator_Variable | T2/T2 | candidate: none-known | none |
| api:SCR_AutocompletePlugin | T2/T2 | candidate: none-known | none |
| api:SCR_AutocompletePlugin_AttributeData | T2/T2 | candidate: none-known | none |
| api:SCR_AutocompletePlugin_KeywordData | T2/T2 | candidate: none-known | none |
| api:SCR_BasicCodeFormatterForcedPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_BasicCodeFormatterPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_BasicCodeFormatterPluginFileReport | T2/T2 | candidate: none-known | none |
| api:SCR_BasicCodeFormatterSpellCheckConfig | T2/T2 | candidate: none-known | none |
| api:SCR_BasicCodeFormatterSpellCheckConfig_ForbiddenWordEntry | T2/T2 | candidate: none-known | none |
| api:SCR_ClassRenamingParam | T2/T2 | candidate: none-known | none |
| api:SCR_ClassRenamingPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_CodeHelper | T2/T2 | candidate: none-known | none |
| api:SCR_CopyClassAndMethodPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_DebugLinePlugin | T2/T2 | candidate: none-known | none |
| api:SCR_DoxygenFillerPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_DoxygenFillerPlugin_Method | T2/T2 | candidate: none-known | none |
| api:SCR_DoxygenFillerPlugin_MethodParameter | T2/T2 | candidate: none-known | none |
| api:SCR_DoxygenFillerPlugin_TestA | T2/T2 | candidate: none-known | none |
| api:SCR_DoxygenFillerPlugin_TestB | T2/T2 | candidate: none-known | none |
| api:SCR_DoxygenFillerPlugin_TestC | T2/T2 | candidate: none-known | none |
| api:SCR_NewScriptPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_NewScriptPlugin_AbsoluteUI | T2/T2 | candidate: none-known | none |
| api:SCR_NewScriptPlugin_RelativeUI | T2/T2 | candidate: none-known | none |
| api:SCR_ScriptTemplateConfig | T2/T2 | candidate: none-known | none |
| api:SCR_ScriptTemplateConfigEntry | T2/T2 | candidate: none-known | none |
| api:SCR_ScriptTemplatePlugin | T2/T2 | candidate: none-known | none |
| api:SCR_VCSBlamePlugin | T2/T2 | candidate: none-known | none |
| api:SCR_VCSCommitPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_VCSDiffPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_VCSLogScriptEditorPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_VCSResourceManagerRootPlugin | T2/T2 | candidate: none-known | none |

4 more: wb_census find with module=ScriptEditor kind=class.

### cli-switch (10)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| cli:-validate | T2/T5 | candidate: cli | [wb_cli_run.buildScripts](../tools/wb_cli_run.md) drive |
| cli:cli-switch/Authorize dangerous script commands | T0/T5 | candidate: cli | none |
| cli:cli-switch/Exit after init | T0/T5 | candidate: cli | none |
| cli:cli-switch/Headless validate | T0/T5 | candidate: cli | none |
| cli:cli-switch/LSP from CLI | T0/T5 | candidate: cli | none |
| cli:cli-switch/Module launch | T0/T5 | candidate: cli | none |
| cli:cli-switch/Script debugger address%2Fport | T0/T5 | candidate: cli | none |
| cli:cli-switch/Script define | T0/T5 | candidate: cli | none |
| cli:cli-switch/Silent init | T0/T5 | candidate: cli | none |
| cli:cli-switch/Skip script compile on init | T0/T5 | candidate: cli | none |

### control (93)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ScriptEditor/control/#Maximize-Restore | T2/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/#Minimize-Restore | T2/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/#bookmarksList | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/#callstackList | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/#consoleButton | T2/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/#consoleHistoryCombo | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/#consoleModuleCombo | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/#errorsList | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/#findEntityCheck | T2/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/#findEntityList | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/#findFileList | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/#findResultsList | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/#findSymbolList | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/#findSymbolsFnCheck | T2/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/#findSymbolsTypesCheck | T2/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/#findSymbolsVarsCheck | T2/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/#outputEdit | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/#watchTree | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/Close | T2/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/Debug/Continue | T1/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/Debug/Step Into | T1/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/Debug/Step Out | T1/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/Debug/Step Over | T1/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/Debug/Stop | T1/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/bookmarksDock/Close | T2/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/bookmarksDock/Float | T2/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/breakpointsDock/@QListWidget.1 | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/breakpointsDock/@QToolButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/breakpointsDock/@QToolButton.2 | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/breakpointsDock/@QToolButton.3 | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/breakpointsDock/@WBEditBox.1 | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/breakpointsDock/@WBEditBox.1/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/breakpointsDock/Close | T2/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/breakpointsDock/Float | T2/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/callstackDock/Close | T2/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/callstackDock/Float | T2/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/consoleDock/@ScriptTextEdit.1 | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/consoleDock/Close | T2/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/consoleDock/Float | T2/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/control/debugDock/Close | T2/T5 | candidate: gui-automation | none |

53 more: wb_census find with module=ScriptEditor kind=control.

### dialog (4)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ScriptEditor/dialog/Debug Custom | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/dialog/External-change prompt | T0/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/dialog/Save-on-close prompt | T0/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/dialog/VM exception dialog | T0/T3 | candidate: gui-automation | none |

### dock (15)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ScriptEditor/dock/#bookmarksDock | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/dock/#breakpointsDock | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/dock/#callstackDock | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/dock/#consoleDock | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/dock/#debugDock | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/dock/#errorsDock | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/dock/#findEntityDock | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/dock/#findFileDock | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/dock/#findResultsDock | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/dock/#findSymbolDock | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/dock/#outlineDock | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/dock/#outputDock | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/dock/#projectTreeDock | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/dock/#searchDock | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/dock/#watchDock | T2/T3 | candidate: gui-automation | none |

### enum (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:SCR_EScriptTemplateType | T2/T2 | candidate: none-known | none |

### enum-value (14)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:SCR_EScriptTemplateType.Component | T2/T2 | candidate: none-known | none |
| api:SCR_EScriptTemplateType.ConfigRoot | T2/T2 | candidate: none-known | none |
| api:SCR_EScriptTemplateType.Entity | T2/T2 | candidate: none-known | none |
| api:SCR_EScriptTemplateType.None | T2/T2 | candidate: none-known | none |
| api:SCR_EScriptTemplateType.ScriptEditorPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_EScriptTemplateType.ScriptInvoker | T2/T2 | candidate: none-known | none |
| api:SCR_EScriptTemplateType.ScriptedUserAction | T2/T2 | candidate: none-known | none |
| api:SCR_EScriptTemplateType.TEST_CASE | T2/T2 | candidate: none-known | none |
| api:SCR_EScriptTemplateType.TEST_SUITE | T2/T2 | candidate: none-known | none |
| api:SCR_EScriptTemplateType.UIMenu | T2/T2 | candidate: none-known | none |
| api:SCR_EScriptTemplateType.WidgetComponent | T2/T2 | candidate: none-known | none |
| api:SCR_EScriptTemplateType.WorkbenchPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_EScriptTemplateType.WorldEditorPlugin | T2/T2 | candidate: none-known | none |
| api:SCR_EScriptTemplateType.WorldEditorTool | T2/T2 | candidate: none-known | none |

### file-type (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| file:.c | T2/T3 | candidate: file-format | [asset_search.run](../tools/asset_search.md) read, [game_browse.run](../tools/game_browse.md) read, [game_read.run](../tools/game_read.md) read, [mod.create](../tools/mod.md) read, [mod.validate](../tools/mod.md) read, [script_analyze.run](../tools/script_analyze.md) read, [script_class_hierarchy.run](../tools/script_class_hierarchy.md) read, [script_create.run](../tools/script_create.md) read, [script_extract_interface.run](../tools/script_extract_interface.md) read, [script_find_rpc_handlers.run](../tools/script_find_rpc_handlers.md) read, [script_format.run](../tools/script_format.md) read, [script_lint.run](../tools/script_lint.md) read, [script_overrides.run](../tools/script_overrides.md) read, [ui_extract_strings.run](../tools/ui_extract_strings.md) read, [wb_cleanup.run](../tools/wb_cleanup.md) read |
| file:file-type/Persisted editor state | T0/T3 | candidate: file-format | none |
| file:file-type/Plugin attribute contract | T0/T3 | candidate: file-format | none |

### handler-action (14)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| mcp:handler-action/EMCP_WB_ScriptEditor.close | T2/T5 | candidate: net-api-handler | [wb_script_editor.close](../tools/wb_script_editor.md) read |
| mcp:handler-action/EMCP_WB_ScriptEditor.getCurrentFile | T0/T5 | candidate: net-api-handler | [wb_script_editor.getCurrentFile](../tools/wb_script_editor.md) read |
| mcp:handler-action/EMCP_WB_ScriptEditor.getLine | T0/T5 | candidate: net-api-handler | [wb_script_editor.getLine](../tools/wb_script_editor.md) read |
| mcp:handler-action/EMCP_WB_ScriptEditor.getLines | T5/T5 | net-api-handler | [wb_script_editor.getLines](../tools/wb_script_editor.md) drive, [wb_script_editor.getLines](../tools/wb_script_editor.md) read |
| mcp:handler-action/EMCP_WB_ScriptEditor.getLinesCount | T0/T5 | candidate: net-api-handler | [wb_script_editor.getLinesCount](../tools/wb_script_editor.md) read |
| mcp:handler-action/EMCP_WB_ScriptEditor.insertLine | T2/T5 | candidate: net-api-handler | [wb_script_editor.insertLine](../tools/wb_script_editor.md) read |
| mcp:handler-action/EMCP_WB_ScriptEditor.jump | T5/T5 | net-api-handler | [wb_script_editor.jump](../tools/wb_script_editor.md) drive, [wb_script_editor.jump](../tools/wb_script_editor.md) read |
| mcp:handler-action/EMCP_WB_ScriptEditor.open | T5/T5 | net-api-handler | [wb_script_editor.open](../tools/wb_script_editor.md) drive, [wb_script_editor.open](../tools/wb_script_editor.md) read |
| mcp:handler-action/EMCP_WB_ScriptEditor.openFile | T0/T5 | candidate: net-api-handler | [wb_script_editor.openFile](../tools/wb_script_editor.md) read |
| mcp:handler-action/EMCP_WB_ScriptEditor.removeLine | T2/T5 | candidate: net-api-handler | [wb_script_editor.removeLine](../tools/wb_script_editor.md) read |
| mcp:handler-action/EMCP_WB_ScriptEditor.replaceRange | T5/T5 | net-api-handler | [wb_script_editor.replaceRange](../tools/wb_script_editor.md) drive, [wb_script_editor.replaceRange](../tools/wb_script_editor.md) read |
| mcp:handler-action/EMCP_WB_ScriptEditor.save | T2/T5 | candidate: net-api-handler | [wb_script_editor.save](../tools/wb_script_editor.md) read |
| mcp:handler-action/EMCP_WB_ScriptEditor.setLine | T2/T5 | candidate: net-api-handler | [wb_script_editor.setLine](../tools/wb_script_editor.md) read |
| mcp:handler-action/EMCP_WB_ScriptEditor.state | T5/T5 | net-api-handler | [wb_script_editor.state](../tools/wb_script_editor.md) drive, [wb_script_editor.state](../tools/wb_script_editor.md) read |

### link-format (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| link:Workbench-link | T0/T5 | candidate: cli | [wb_link.build](../tools/wb_link.md) read, [wb_link.open](../tools/wb_link.md) drive, [wb_link.parse](../tools/wb_link.md) read |
| link:enfusion://ScriptEditor | T1/T5 | candidate: cli | [wb_link.build](../tools/wb_link.md) read, [wb_link.open](../tools/wb_link.md) drive, [wb_link.parse](../tools/wb_link.md) read |
| link:https://community.bistudio.com/wiki/Arma_Reforger:Script_Editor | T2/T5 | candidate: file-format | none |

### mcp-action (14)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| mcp:action/wb_script_editor.close | T3/T5 | candidate: none-known | [wb_script_editor.close](../tools/wb_script_editor.md) drive |
| mcp:action/wb_script_editor.getCurrentFile | T5/T5 | net-api-handler | [wb_script_editor.getCurrentFile](../tools/wb_script_editor.md) drive |
| mcp:action/wb_script_editor.getLine | T5/T5 | net-api-handler | [wb_script_editor.getLine](../tools/wb_script_editor.md) drive |
| mcp:action/wb_script_editor.getLines | T5/T5 | net-api-handler | [wb_script_editor.getLines](../tools/wb_script_editor.md) drive |
| mcp:action/wb_script_editor.getLinesCount | T5/T5 | net-api-handler | [wb_script_editor.getLinesCount](../tools/wb_script_editor.md) drive |
| mcp:action/wb_script_editor.insertLine | T5/T5 | net-api-handler | [wb_script_editor.insertLine](../tools/wb_script_editor.md) drive |
| mcp:action/wb_script_editor.jump | T5/T5 | net-api-handler | [wb_script_editor.jump](../tools/wb_script_editor.md) drive |
| mcp:action/wb_script_editor.open | T5/T5 | net-api-handler | [wb_script_editor.open](../tools/wb_script_editor.md) drive |
| mcp:action/wb_script_editor.openFile | T5/T5 | net-api-handler | [wb_script_editor.openFile](../tools/wb_script_editor.md) drive |
| mcp:action/wb_script_editor.removeLine | T5/T5 | net-api-handler | [wb_script_editor.removeLine](../tools/wb_script_editor.md) drive |
| mcp:action/wb_script_editor.replaceRange | T5/T5 | net-api-handler | [wb_script_editor.replaceRange](../tools/wb_script_editor.md) drive |
| mcp:action/wb_script_editor.save | T3/T5 | candidate: none-known | [wb_script_editor.save](../tools/wb_script_editor.md) drive |
| mcp:action/wb_script_editor.setLine | T5/T5 | net-api-handler | [wb_script_editor.setLine](../tools/wb_script_editor.md) drive |
| mcp:action/wb_script_editor.state | T5/T5 | net-api-handler | [wb_script_editor.state](../tools/wb_script_editor.md) drive |

### mcp-tool (4)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| mcp:mcp-tool/API lookup | T0/T5 | candidate: file-format | none |
| mcp:mcp-tool/New script from template | T0/T5 | candidate: file-format | none |
| mcp:mcp-tool/Vanilla script read and browse | T0/T5 | candidate: file-format | none |
| mcp:tool/wb_script_editor | T2/T2 | candidate: none-known | none |

### menu (12)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ScriptEditor/menu/Bookmarks | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/menu/Build | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/menu/Debug | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/menu/Edit | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/menu/File | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/menu/Help | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/menu/Plugins | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/menu/Plugins/Settings | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/menu/Plugins/Version Control System | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/menu/Window | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/menu/Window/Layout | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/menu/Windows | T1/T3 | candidate: gui-automation | none |

### menu-item (141)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ScriptEditor/menu-item/Bookmarks/Next Bookmark | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Bookmarks/Previous Bookmark | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Bookmarks/Toggle Bookmark | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Breakpoints panel actions | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/menu-item/Build configuration selector | T0/T5 | candidate: builtin-net-handler | none |
| ui:ScriptEditor/menu-item/Build/@QWidgetAction.1 | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Build/ALL | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Build/Compile and Reload Scripts | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Build/PC | T3/T5 | candidate: execute-action, gui-automation | [wb_scripts.validate](../tools/wb_scripts.md) drive |
| ui:ScriptEditor/menu-item/Build/PS4 | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Build/PS5 | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Build/Reload Scripts | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Build/Validate Scripts | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Build/Validate and Reload Scripts | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Build/WORKBENCH | T3/T5 | candidate: execute-action, gui-automation | [wb_scripts.validate](../tools/wb_scripts.md) drive |
| ui:ScriptEditor/menu-item/Build/XBOX | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Comment Selection Toggle | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/menu-item/Common tab actions (Close Tab Ctrl+W, Next%2FPrevious Tab, Cycle Tabs, Reopen Closed Tab) | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/menu-item/Console Execute | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/menu-item/Continue (F5) | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Copy Link (Ctrl+Shift+L) | T0/T5 | candidate: net-api-handler | none |
| ui:ScriptEditor/menu-item/Debug/Console Execute | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Debug/Continue | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Debug/Debug Client | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Debug/Debug Custom | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Debug/Debug Disabled | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Debug/Debug Game | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Debug/Debug Workbench | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Debug/Dump Classes | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Debug/Insert Breakpoint | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Debug/Recompile File on Host | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Debug/Step Into | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Debug/Step Out | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Debug/Step Over | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Debug/Stop | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Debug/Toggle Breakpoint | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Dump Classes | T0/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Duplicate Line (Ctrl+D) | T0/T5 | candidate: net-api-handler | none |
| ui:ScriptEditor/menu-item/Edit/Comment Selection Toggle | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/menu-item/Edit/Copy Link | T2/T5 | candidate: execute-action, gui-automation | none |

101 more: wb_census find with module=ScriptEditor kind=menu-item.

### method (193)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:SCR_AiScriptGeneratorPlugin.Run/0 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGeneratorPlugin.RunButton/0 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGeneratorPlugin.WriteLinesToFile/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_Class.GetListing/0 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_ClassGeneratorBase.Generate/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_ClassGeneratorBase.GenerateCommentSeparator/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_ClassGeneratorBase.GenerateGetNodeMiddleText/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_ClassGeneratorBase.GenerateGetVariablesIn/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_ClassGeneratorBase.GenerateSetMessageVariables/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_ClassGeneratorBase.GenerateVariablesWithAttributes/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_ClassGeneratorBase.GetClassVariables/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_ClassGeneratorBase.SCR_AiScriptGenerator_ClassGeneratorBase/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_OutputFormatBuffer.AddLine/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_OutputFormatBuffer.GetLines/0 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_Parser.ExtractClass/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_Parser.ExtractComment/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_Parser.ExtractMacro/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_Parser.ExtractVariable/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_Parser.FindRelatedClasses/0 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_Parser.GetParsedClasses/0 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_Parser.ParseLine/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_Parser.ParseLines/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_Parser.PrintListing/0 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_Parser.ResetContext/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_Parser.Unquote/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_Parser.VerifyMacroArgumentCount/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_Parser.VerifyMacro_MessageClass/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_Parser.VerifyMacro_Variable/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_Parser._print/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_SendGoalMessageGenerator.Generate/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_SendInfoMessageGenerator.Generate/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_SendOrderGenerator.Generate/1 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AiScriptGenerator_Variable.GetListing/0 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AutocompletePlugin.AddAttributeDecorator/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AutocompletePlugin.AddCastCheck/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AutocompletePlugin.AddComment/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AutocompletePlugin.AddConstructorDestructor/4 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AutocompletePlugin.AddIndentation/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AutocompletePlugin.AddNewType/4 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AutocompletePlugin.AddPrintLogLevel/4 | T2/T5 | candidate: net-api-handler | none |

153 more: wb_census find with module=ScriptEditor kind=method.

### module (13)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ScriptEditor/module/AnimEditor module | T1/T5 | candidate: execute-action, gui-automation, net-api-handler | none |
| ui:ScriptEditor/module/AudioEditor module | T1/T5 | candidate: execute-action, gui-automation, net-api-handler | none |
| ui:ScriptEditor/module/BehaviorEditor module | T1/T5 | candidate: execute-action, gui-automation, net-api-handler | none |
| ui:ScriptEditor/module/DialogueEditor module | T1/T5 | candidate: net-api-handler | none |
| ui:ScriptEditor/module/LocalizationEditor module | T1/T5 | candidate: cli, net-api-handler | none |
| ui:ScriptEditor/module/NavmeshGeneratorMain module | T1/T5 | candidate: cli, execute-action, net-api-handler | none |
| ui:ScriptEditor/module/ParticleEditor module | T1/T5 | candidate: execute-action, gui-automation, net-api-handler | none |
| ui:ScriptEditor/module/ProcAnimEditor module | T1/T5 | candidate: execute-action, gui-automation, net-api-handler | none |
| ui:ScriptEditor/module/ResourceManager module | T1/T5 | candidate: cli, net-api-handler | none |
| ui:ScriptEditor/module/ScriptEditor | T1/T5 | candidate: builtin-net-handler, net-api-handler | [wb_script_editor.open](../tools/wb_script_editor.md) drive |
| ui:ScriptEditor/module/ScriptEditor module | T1/T5 | candidate: cli, net-api-handler | none |
| ui:ScriptEditor/module/WorldEditor | T1/T5 | candidate: net-api-handler | none |
| ui:ScriptEditor/module/WorldEditor module | T1/T5 | candidate: cli, net-api-handler | none |

### net-function (6)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| net:net-function/LSP completion | T0/T5 | candidate: builtin-net-handler | [script_lsp.completion](../tools/script_lsp.md) drive |
| net:net-function/LSP diagnostics | T0/T5 | candidate: builtin-net-handler | [script_lsp.diagnostics](../tools/script_lsp.md) drive |
| net:net-function/LSP hover | T0/T5 | candidate: builtin-net-handler | [script_lsp.hover](../tools/script_lsp.md) drive |
| net:net-function/LSP open%2Fclose%2Fchange%2FwillSave | T0/T5 | candidate: builtin-net-handler | none |
| net:net-function/LSP server | T0/T5 | candidate: builtin-net-handler | [script_lsp.status](../tools/script_lsp.md) read |
| net:net-function/LSP signature help | T0/T5 | candidate: builtin-net-handler | [script_lsp.signature](../tools/script_lsp.md) drive |

### net-handler (9)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| net:handler/EMCP_WB_CreateEntity | T0/T5 | candidate: net-api-handler | none |
| net:handler/EMCP_WB_DeleteEntity | T0/T5 | candidate: net-api-handler | none |
| net:handler/EMCP_WB_ExecuteAction | T0/T5 | candidate: execute-action | none |
| net:handler/EMCP_WB_GetCameraPos | T0/T5 | candidate: net-api-handler | none |
| net:handler/EMCP_WB_GetEntity | T0/T5 | candidate: net-api-handler | none |
| net:handler/EMCP_WB_GetState | T0/T5 | candidate: net-api-handler | none |
| net:handler/EMCP_WB_ListEntities | T0/T5 | candidate: net-api-handler | none |
| net:handler/EMCP_WB_Ping | T0/T5 | candidate: net-api-handler | none |
| net:handler/EMCP_WB_Reload | T0/T5 | candidate: execute-action | none |

### option (9)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ScriptEditor/option/Option: Append closing bracket | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/option/Option: Auto-rebuild scripts | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/option/Option: Font Family | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/option/Option: Font Size | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/option/Option: LSP enable and port | T0/T5 | candidate: file-format, gui-automation | none |
| ui:ScriptEditor/option/Option: Net API enable and port | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/option/Option: Shortcuts, Script Editor category | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/option/Option: Show scroll-bar markers | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/option/Option: Tab Size | T0/T5 | candidate: gui-automation | none |

### panel (41)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ScriptEditor/panel/#qt_tabwidget_tabbar | T0/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/@QMainWindowTabBar.1 | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/@QMainWindowTabBar.2 | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/@QMainWindowTabBar.3 | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/@QMainWindowTabBar.4 | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/@QMainWindowTabBar.5 | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/@QStatusBar.1 | T0/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Bookmarks | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Bookmarks (bookmarksDock) | T0/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Breakpoints | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Breakpoints (breakpointsDock) | T0/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Callstack | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Callstack (callstackDock) | T0/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Console | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Debug | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Debug (debugDock) | T0/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Dock layout (open, close, dock, undock; "Perspectives") | T0/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Errors | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Errors (errorsDock, errorsList) | T0/T3 | candidate: builtin-net-handler | none |
| ui:ScriptEditor/panel/Find Entity | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Find Entity (findEntityDock) | T0/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Find File | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Find File (findFileDock) | T0/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Find Results | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Find Results (findResultsDock) | T0/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Find Symbol | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Find Symbol (findSymbolDock) | T0/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Find in Files | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Outline | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Outline (outlineDock) | T0/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Output | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Output (outputDock, outputEdit) | T0/T3 | candidate: file-format | none |
| ui:ScriptEditor/panel/Projects | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Projects (projectTreeDock) | T0/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Remote Console (consoleDock) | T0/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Text Editor | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Text Editor, two panes (codeTab, codeTab2) | T0/T3 | candidate: net-api-handler | none |
| ui:ScriptEditor/panel/Text Search | T2/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Text Search (searchDock) | T0/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/panel/Watch | T1/T3 | candidate: gui-automation | none |

1 more: wb_census find with module=ScriptEditor kind=panel.

### plugin (156)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:SCR_AiScriptGeneratorPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_AutocompletePlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterForcedPlugin | T2/T2 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin | T2/T2 | candidate: plugin-run | none |
| plugin:SCR_ClassRenamingPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_CopyClassAndMethodPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DebugLinePlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DoxygenFillerPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_NewScriptPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ScriptTemplatePlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_VCSBlamePlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_VCSCommitPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_VCSDiffPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_VCSLogScriptEditorPlugin | T2/T5 | candidate: plugin-run | none |
| plugin:plugin/AI Script Generator | T0/T5 | candidate: gui-automation | none |
| plugin:plugin/AddonBuildInfoTool "Generate addon.ci-info files" | T0/T5 | candidate: cli, execute-action, plugin-run | none |
| plugin:plugin/Autocomplete (Ctrl+Return) | T0/T5 | candidate: plugin-run | none |
| plugin:plugin/Autotest (F4; "Run test" in the settings dump) | T0/T5 | candidate: plugin-run | none |
| plugin:plugin/BakeMLODPlugin "EBT: Bake MLOD" | T0/T5 | candidate: file-format, plugin-run | none |
| plugin:plugin/Basic Code Formatter (Ctrl+Shift+K) | T0/T5 | candidate: plugin-run | none |
| plugin:plugin/Basic Code Formatter - forced (Ctrl+Alt+Shift+K) | T0/T5 | candidate: plugin-run | none |
| plugin:plugin/BatchTextureProcessorPlugin "Batch texture processor" | T0/T5 | candidate: execute-action, plugin-run | none |
| plugin:plugin/BuildShoreMap "Build shore map" | T0/T5 | candidate: cli | none |
| plugin:plugin/BuildShoreMapWEPlugin "Build shore map" | T0/T5 | candidate: execute-action, plugin-run | none |
| plugin:plugin/CameraOrientationTool "Set camera orientation to entity" | T0/T5 | candidate: execute-action, plugin-run | none |
| plugin:plugin/CheckLocalizationPlugin "Check localization in UI" | T0/T5 | candidate: execute-action, plugin-run | none |
| plugin:plugin/Class Renaming Plugin | T0/T5 | candidate: plugin-run | none |
| plugin:plugin/Copy Class and Method Name (Ctrl+Shift+C) | T0/T5 | candidate: plugin-run | none |
| plugin:plugin/Create New Script (Ctrl+N) | T0/T5 | candidate: file-format, gui-automation | none |
| plugin:plugin/Debug Line Shortcut (Ctrl+Shift+D) | T0/T5 | candidate: plugin-run | none |
| plugin:plugin/Doxygen Filler (Ctrl+Alt+Shift+D) | T0/T5 | candidate: plugin-run | none |
| plugin:plugin/EBTConfigPlugin "EBT: Config" | T0/T5 | candidate: file-format, plugin-run | none |
| plugin:plugin/EditorPlugin "Game Master Settings" | T0/T5 | candidate: cli | none |
| plugin:plugin/EntityOrientationTool "Set entity to view orientation" | T0/T5 | candidate: execute-action, plugin-run | none |
| plugin:plugin/EntityRelativePlugin "Change absolute Y to relative" | T0/T5 | candidate: execute-action, plugin-run | none |
| plugin:plugin/Fill from Template (Ctrl+T) | T0/T5 | candidate: file-format, gui-automation | none |
| plugin:plugin/GenerateFlowMaps "Regenerate river flow-maps" | T0/T5 | candidate: cli | none |
| plugin:plugin/GenerateFlowMapsWEPlugin "Regenerate river flow-maps" | T0/T5 | candidate: execute-action, plugin-run | none |
| plugin:plugin/PeerPlugin "Peer Tool" | T0/T5 | candidate: file-format, plugin-run | none |
| plugin:plugin/ResaveMetaPlugin "Re-Save Meta Tool" | T0/T5 | candidate: cli, execute-action, plugin-run | none |

116 more: wb_census find with module=ScriptEditor kind=plugin.

### plugin-button (11)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:SCR_AiScriptGeneratorPlugin#button:RunButton | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_AutocompletePlugin#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin#button:ButtonCancel | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin#button:ButtonOK | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ClassRenamingPlugin#button:ButtonCancel | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ClassRenamingPlugin#button:ButtonRun | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ClassRenamingPlugin#button:ButtonRunAll | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DebugLinePlugin#button:ButtonClose | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_DoxygenFillerPlugin#button:ButtonOK | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ScriptTemplatePlugin#button:ButtonCancel | T2/T5 | candidate: plugin-run | none |
| plugin:SCR_ScriptTemplatePlugin#button:ButtonConfirm | T2/T5 | candidate: plugin-run | none |

### plugin-setting (74)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:SCR_AiScriptGeneratorPlugin#attr:m_sConfig | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutocompletePlugin#attr:m_aToolAttributeDecorators | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutocompletePlugin#attr:m_aToolKeywords | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutocompletePlugin#attr:m_aUserAttributeDecorators | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutocompletePlugin#attr:m_aUserKeywords | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutocompletePlugin#attr:m_bAddCastNullcheck | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutocompletePlugin#attr:m_bAddConstructor | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutocompletePlugin#attr:m_bAddDestructor | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutocompletePlugin#attr:m_bAddInstantiation | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutocompletePlugin#attr:m_bAddOrFixResourceLoadValidityCheck | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutocompletePlugin#attr:m_bAllowMissingKeywordParameters | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutocompletePlugin#attr:m_bFixInstantiation | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutocompletePlugin#attr:m_bFixSeparator | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutocompletePlugin#attr:m_bKeepCommentIndentation | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutocompletePlugin#attr:m_bUseToolAttributeDecorators | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutocompletePlugin#attr:m_bUseToolKeywords | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutocompletePlugin#attr:m_bUseUserAttributeDecorators | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutocompletePlugin#attr:m_bUseUserKeywords | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutocompletePlugin#attr:m_eAddPrintLogLevel | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_AutocompletePlugin#attr:m_iInstantiationTrigger | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin#attr:m_SpellCheckConfig | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin#attr:m_aAcceptedScriptPrefixes | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin#attr:m_aExcludedDirectories | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin#attr:m_bAddFinalLineReturn | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin#attr:m_bBatchProcessAddon | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin#attr:m_bDemoMode | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin#attr:m_bFixMethodSeparators | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin#attr:m_bFixTabs | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin#attr:m_bGeneralFormatting | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin#attr:m_bLogFixes | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin#attr:m_bOnlyFormatModifiedLines | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin#attr:m_bOnlyLogChanges | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin#attr:m_bReportFindings | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin#attr:m_bShowSpellCheckFindingsDetails | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin#attr:m_bSilentExecution | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin#attr:m_bTrimLineEnds | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin#attr:m_iAddon | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin#attr:m_iMaxLoggedReports | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_BasicCodeFormatterPlugin#attr:m_sDiffCommand | T2/T4 | candidate: plugin-run | none |
| plugin:SCR_ClassRenamingPlugin#attr:m_aConfigDirectories | T2/T4 | candidate: plugin-run | none |

34 more: wb_census find with module=ScriptEditor kind=plugin-setting.

### region (18)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ScriptEditor/region/#SystemMenuBar | T0/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/region/#centralwidget | T0/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/region/#dockWidgetContents_11 | T0/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/region/#dockWidgetContents_4 | T0/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/region/#dockWidgetContents_5 | T0/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/region/#dockWidgetContents_7 | T0/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/region/@QMenuBar.1 | T0/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/region/@QStatusBar.1/@QLabel.1 | T0/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/region/@QStatusBar.1/@QSizeGrip.1 | T0/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/region/@TitleBar.1 | T0/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/region/consoleDock/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/region/consoleDock/@ScriptTextEdit.1/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/region/consoleDock/@ScriptTextEdit.1/@QWidget.2 | T0/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/region/errorsDock/errorsList/@Header.1 | T0/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/region/errorsDock/errorsList/@Header.2 | T0/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/region/errorsDock/errorsList/@Header.3 | T0/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/region/errorsDock/errorsList/@Header.4 | T0/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/region/outputDock/outputEdit/@QWidget.1 | T0/T2 | candidate: gui-automation | none |

### setting-key (30)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| setting:Script Editor%2FErrorsPanel/columnWidth0 | T0/T3 | candidate: file-format | none |
| setting:Script Editor%2FErrorsPanel/columnWidth1 | T0/T3 | candidate: file-format | none |
| setting:Script Editor%2FErrorsPanel/columnWidth2 | T0/T3 | candidate: file-format | none |
| setting:Script Editor%2FErrorsPanel/columnWidth3 | T0/T3 | candidate: file-format | none |
| setting:Script Editor%2FPerspectives%2Fedit/Geometry | T0/T3 | candidate: file-format | none |
| setting:Script Editor%2FPerspectives%2Fedit/State | T0/T3 | candidate: file-format | none |
| setting:Script Editor/BOOKMARKS | T0/T3 | candidate: file-format | none |
| setting:Script Editor/BREAKPOINTS | T0/T3 | candidate: file-format | none |
| setting:Script Editor/CONFIGURATION | T0/T3 | candidate: file-format | none |
| setting:Script Editor/CONSOLE_HISTORY | T0/T3 | candidate: file-format | none |
| setting:Script Editor/CONSOLE_MODULE | T0/T3 | candidate: file-format | none |
| setting:Script Editor/CONSOLE_TEXT | T0/T3 | candidate: file-format | none |
| setting:Script Editor/DBG_PORT | T0/T3 | candidate: file-format | none |
| setting:Script Editor/FIND_METHODS | T0/T3 | candidate: file-format | none |
| setting:Script Editor/FIND_TYPES | T0/T3 | candidate: file-format | none |
| setting:Script Editor/FIND_VARS | T0/T3 | candidate: file-format | none |
| setting:Script Editor/OPEN_FILES | T0/T3 | candidate: file-format | none |
| setting:Script Editor/OPEN_FILES2 | T0/T3 | candidate: file-format | none |
| setting:Script Editor/OPEN_FILE_INDEX | T0/T3 | candidate: file-format | none |
| setting:Script Editor/OPEN_FILE_INDEX2 | T0/T3 | candidate: file-format | none |
| setting:Script Editor/SEARCH_ENTITIES_SCRIPT | T0/T3 | candidate: file-format | none |
| setting:Script Editor/SEARCH_HIGHLIGHT_TEXT | T0/T3 | candidate: file-format | none |
| setting:Script Editor/SEARCH_HISTORY | T0/T3 | candidate: file-format | none |
| setting:Script Editor/SEARCH_MATCH_CASE | T0/T3 | candidate: file-format | none |
| setting:Script Editor/SEARCH_MATCH_WORD | T0/T3 | candidate: file-format | none |
| setting:Script Editor/SEARCH_REGEXP | T0/T3 | candidate: file-format | none |
| setting:Script Editor/SEARCH_SCOPE | T0/T3 | candidate: file-format | none |
| setting:Script Editor/SEARCH_WRAP_AROUND | T0/T3 | candidate: file-format | none |
| setting:Script Editor/currentPerspective | T0/T3 | candidate: file-format | none |
| setting:Script Editor/legacyOptionsLoaded | T0/T3 | candidate: file-format | none |

### shortcut (83)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ScriptEditor/shortcut/Close Current Tab | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Compile | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Compile current file on host (game) | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Cycle Tabs | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Duplicate Line %2F Selected Text | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Edit/Copy link option | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Find Files | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Find Next | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Find Previous | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Find Stack Trace | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Find Symbols | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Find in Symbols, Goto Declaration | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Find in all files | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Find in current file | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Highlight selection | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Insert Breakpoint | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Jump To Line | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Navigate Back | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Next Bookmark | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Next Tab | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Open File | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Previous Bookmark | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Previous Tab | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/SVN Plugins/SVN Blame | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/SVN Plugins/SVN Diff | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/SVN Plugins/SVN Log | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Save All | T1/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Script Editor Plugins/AI Script Generator | T2/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Script Editor Plugins/Autocomplete | T2/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Script Editor Plugins/Basic Code Formatter | T2/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Script Editor Plugins/Basic Code Formatter - forced | T2/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Script Editor Plugins/Class Renaming Plugin | T2/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Script Editor Plugins/Copy Class and Method Name | T2/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Script Editor Plugins/Create New Script | T2/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Script Editor Plugins/Debug Line Shortcut | T2/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Script Editor Plugins/Doxygen Filler | T2/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Script Editor Plugins/Fill from Template | T2/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Script Editor Plugins/Normal-Aligned Floaters Finder | T2/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Script Editor Plugins/Run Tracy Profiler | T2/T2 | candidate: gui-automation | none |
| ui:ScriptEditor/shortcut/Script Editor Plugins/VCS Blame | T2/T2 | candidate: gui-automation | none |

43 more: wb_census find with module=ScriptEditor kind=shortcut.

### static-method (38)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:SCR_AiScriptGeneratorPlugin._print/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AutocompletePlugin_AttributeData.Create/4 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_AutocompletePlugin_KeywordData.Create/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BasicCodeFormatterPlugin.GetIndentAndLineContent/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BasicCodeFormatterPlugin.GetIndentAndLineContentAsPieces/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_BasicCodeFormatterPlugin.JoinLineNumbers/2 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_CodeHelper.GetIndentAndLineContent/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_CodeHelper.GetIndentAndLineContentAsPieces/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_CopyClassAndMethodPlugin.GetCursorClassAndMethodNames/3 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_CopyClassAndMethodPlugin.GetLineClassAndMethodNames/4 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_DebugLinePlugin.GetLogLevelEnumOptions/0 | T2/T5 | candidate: net-api-handler | none |
| api:SCR_DoxygenFillerPlugin.AddIndent/3 | T2/T5 | candidate: net-api-handler | none |
| api:static-method/Addon enumeration | T0/T5 | candidate: builtin-net-handler, net-api-handler | none |
| api:static-method/CLI parameter read | T0/T5 | candidate: net-api-handler | none |
| api:static-method/Clipboard | T0/T5 | candidate: net-api-handler | none |
| api:static-method/Close module window | T0/T5 | candidate: net-api-handler | none |
| api:static-method/Current project file | T0/T5 | candidate: net-api-handler | none |
| api:static-method/Executable path | T0/T5 | candidate: net-api-handler | none |
| api:static-method/Exit Workbench | T0/T5 | candidate: net-api-handler | none |
| api:static-method/Get module instance | T0/T5 | candidate: net-api-handler | none |
| api:static-method/Jump to script symbol | T0/T5 | candidate: net-api-handler | none |
| api:static-method/Message dialog | T0/T5 | candidate: net-api-handler | none |
| api:static-method/New GUID | T0/T5 | candidate: net-api-handler | none |
| api:static-method/OS user name | T0/T5 | candidate: net-api-handler | none |
| api:static-method/Open module window | T0/T5 | candidate: net-api-handler | none |
| api:static-method/Open resource | T0/T5 | candidate: builtin-net-handler, net-api-handler | none |
| api:static-method/Packed UTC time | T0/T5 | candidate: net-api-handler | none |
| api:static-method/Path to ResourceName | T0/T5 | candidate: builtin-net-handler, net-api-handler | none |
| api:static-method/Project settings container | T0/T5 | candidate: file-format, net-api-handler | none |
| api:static-method/Resolve path | T0/T5 | candidate: net-api-handler | none |
| api:static-method/Run shell command | T0/T5 | candidate: net-api-handler | none |
| api:static-method/Runtime script compile | T0/T5 | candidate: net-api-handler | none |
| api:static-method/Save raw pixels as PNG | T0/T5 | candidate: net-api-handler | none |
| api:static-method/Screenshot | T0/T5 | candidate: net-api-handler | none |
| api:static-method/Scripted dialog | T0/T5 | candidate: net-api-handler | none |
| api:static-method/Workbench script module | T0/T5 | candidate: net-api-handler | none |
| api:static-method/WorkbenchGame script module | T0/T5 | candidate: net-api-handler | none |
| api:static-method/Working directory | T0/T5 | candidate: net-api-handler | none |

### status-item (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ScriptEditor/status-item/@QStatusBar.1/Version 1.8.0.13 (production) | T2/T2 | candidate: gui-automation | none |

### tab (28)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ScriptEditor/tab/@QMainWindowTabBar/Bookmarks | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/@QMainWindowTabBar/Breakpoints | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/@QMainWindowTabBar/Callstack | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/@QMainWindowTabBar/Errors | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/@QMainWindowTabBar/Find Entity | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/@QMainWindowTabBar/Find File | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/@QMainWindowTabBar/Find Results | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/@QMainWindowTabBar/Find Symbol | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/@QMainWindowTabBar/Outline | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/@QMainWindowTabBar/Output | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/@QMainWindowTabBar/Projects | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/@QMainWindowTabBar/Remote Console | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/@QMainWindowTabBar/Text Search | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/@QMainWindowTabBar/Watch | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/Breakpoints/Breakpoints | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/Breakpoints/Callstack | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/Breakpoints/Output | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/Errors/Errors | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/Errors/Find Results | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/Errors/Watch | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/Find Symbol/Bookmarks | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/Find Symbol/Find Entity | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/Find Symbol/Find File | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/Find Symbol/Find Symbol | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/Outline/Outline | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/Outline/Projects | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/Text Search/Remote Console | T1/T3 | candidate: gui-automation | none |
| ui:ScriptEditor/tab/Text Search/Text Search | T1/T3 | candidate: gui-automation | none |

### tool (19)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ScriptEditor/tool/BakeMlodTool "Bake MLOD Texture" | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/tool/MeasureTool "Measure Tool" | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/tool/SCR_AutoSpawnerTool "Autospawner Tool" | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/tool/SCR_AutotestTool "Autotest Tool" | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/tool/SCR_BatchPrefabsOperationsTool "Batch prefabs operations tool" | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/tool/SCR_BuildingDestructionSetupTool "Prefab Destruction Setup Tool" | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/tool/SCR_CoordsTool "Coords Tool" | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/tool/SCR_DestructiblePrefabFinderTool "Destructible Prefab Finder Tool" | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/tool/SCR_DestructionIndicesAssignTool "Destruction indices assign tool" | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/tool/SCR_EntityReplacerTool "Entity Replacer" | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/tool/SCR_GenerateWindowsPrefabsTool "Windows Prefabs Generator Tool" | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/tool/SCR_ObjectBrushTool "Object Brush" | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/tool/SCR_ParallelShapeTool "Parallel Shape Tool" | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/tool/SCR_PrefabBoneSnappingTool "Prefab Bone-Snapping Tool" | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/tool/SCR_PrefabManagementTool "Prefab Management Tool" | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/tool/SCR_SelectionBrushTool "Object Selection Brush" | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/tool/SCR_ShapeAreaTool "Shape Area Tool" | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/tool/SCR_ShapeBrushTool "Shape Brush Tool" | T0/T5 | candidate: gui-automation | none |
| ui:ScriptEditor/tool/SCR_WorldMapExportTool "Export Map data" | T0/T5 | candidate: gui-automation | none |

### toolbar (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ScriptEditor/toolbar/debugDock/@QToolBar.1 | T0/T3 | candidate: gui-automation | none |

### toolbar-button (5)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ScriptEditor/toolbar-button/debugDock/@QToolBar.1/Continue | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/toolbar-button/debugDock/@QToolBar.1/Step Into | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/toolbar-button/debugDock/@QToolBar.1/Step Out | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/toolbar-button/debugDock/@QToolBar.1/Step Over | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ScriptEditor/toolbar-button/debugDock/@QToolBar.1/Stop | T2/T5 | candidate: execute-action, gui-automation | none |

### window (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ScriptEditor/window/#ScriptEditorMain | T2/T3 | candidate: gui-automation | none |

## Below target (951)

- T0 to T2: 19
- T0 to T3: 55
- T0 to T4: 3
- T0 to T5: 329
- T1 to T2: 30
- T1 to T3: 47
- T1 to T5: 23
- T2 to T3: 33
- T2 to T4: 71
- T2 to T5: 336
- T3 to T5: 5

| id | tier | path |
| --- | --- | --- |
| api:EMCP_WB_Common | T0/T2 | candidate: none-known |
| api:SCR_AiScriptGeneratorPlugin.Run/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGeneratorPlugin.RunButton/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGeneratorPlugin.WriteLinesToFile/2 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGeneratorPlugin._print/2 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_Class.GetListing/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_ClassGeneratorBase.Generate/1 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_ClassGeneratorBase.GenerateCommentSeparator/1 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_ClassGeneratorBase.GenerateGetNodeMiddleText/2 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_ClassGeneratorBase.GenerateGetVariablesIn/3 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_ClassGeneratorBase.GenerateSetMessageVariables/2 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_ClassGeneratorBase.GenerateVariablesWithAttributes/2 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_ClassGeneratorBase.GetClassVariables/1 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_ClassGeneratorBase.SCR_AiScriptGenerator_ClassGeneratorBase/1 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_OutputFormatBuffer.AddLine/1 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_OutputFormatBuffer.GetLines/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_Parser.ExtractClass/3 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_Parser.ExtractComment/1 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_Parser.ExtractMacro/3 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_Parser.ExtractVariable/3 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_Parser.FindRelatedClasses/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_Parser.GetParsedClasses/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_Parser.ParseLine/2 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_Parser.ParseLines/2 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_Parser.PrintListing/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_Parser.ResetContext/1 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_Parser.Unquote/1 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_Parser.VerifyMacroArgumentCount/3 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_Parser.VerifyMacro_MessageClass/1 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_Parser.VerifyMacro_Variable/1 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_Parser._print/3 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_SendGoalMessageGenerator.Generate/1 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_SendInfoMessageGenerator.Generate/1 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_SendOrderGenerator.Generate/1 | T2/T5 | candidate: net-api-handler |
| api:SCR_AiScriptGenerator_Variable.GetListing/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutocompletePlugin.AddAttributeDecorator/3 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutocompletePlugin.AddCastCheck/3 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutocompletePlugin.AddComment/2 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutocompletePlugin.AddConstructorDestructor/4 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutocompletePlugin.AddIndentation/2 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutocompletePlugin.AddNewType/4 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutocompletePlugin.AddPrintLogLevel/4 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutocompletePlugin.AddResourceLoadValidityCheck/3 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutocompletePlugin.AutoCompleteCurrentLine/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutocompletePlugin.ButtonClose/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutocompletePlugin.CheckToolAttributeDecorators/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutocompletePlugin.CheckToolKeywords/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutocompletePlugin.Configure/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutocompletePlugin.FillAttributeDecoratorMap/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutocompletePlugin.FillKeywordsMap/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutocompletePlugin.FixInstantiation/4 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutocompletePlugin.FixSeparator/3 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutocompletePlugin.Run/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutocompletePlugin.TryKeywords/4 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutocompletePlugin_AttributeData.Create/4 | T2/T5 | candidate: net-api-handler |
| api:SCR_AutocompletePlugin_KeywordData.Create/3 | T2/T5 | candidate: net-api-handler |
| api:SCR_BasicCodeFormatterForcedPlugin.Run/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_BasicCodeFormatterPlugin.AddFinalLineReturnToCurrentFile/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_BasicCodeFormatterPlugin.ButtonCancel/0 | T2/T5 | candidate: net-api-handler |
| api:SCR_BasicCodeFormatterPlugin.ButtonOK/0 | T2/T5 | candidate: net-api-handler |

891 more: wb_census find with module=ScriptEditor.

## Dispositions (75)

| id | kind | why | evidence |
| --- | --- | --- | --- |
| api:EMCP_WB_Common | absent-in-build | G3 frontier: mirrors the recon_resolution absent-in-build already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:SCR_BasicCodeFormatterForcedPlugin.Run/0 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterForcedPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterForcedPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPlugin.AddFinalLineReturnToCurrentFile/0 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPlugin.ButtonCancel/0 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPlugin.ButtonOK/0 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPlugin.Configure/0 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (wb_plugin never calls Configure) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPlugin.GeneralFormatting/2 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPlugin.GetFileModifiedLineNumbers/2 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPlugin.GetIndentAndLineContent/3 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPlugin.GetIndentAndLineContentAsPieces/3 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPlugin.HasBadVariableNaming/2 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPlugin.Initialise/0 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPlugin.JoinLineNumbers/2 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPlugin.PrintFinding/3 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPlugin.PrintReport/3 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPlugin.ProcessFile/2 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPlugin.ProcessFiles/2 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPlugin.ReadFileContent/2 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPlugin.Run/0 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPlugin.RunAddonFilesBatchProcess/0 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPlugin.RunCurrentFile/0 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPlugin.RunForced/0 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPlugin.SCR_BasicCodeFormatterPlugin/0 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (no method parameter, DEC-048) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPluginFileReport.IsClean/0 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_BasicCodeFormatterPluginFileReport.SCR_BasicCodeFormatterPluginFileReport/2 | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:SCR_CopyClassAndMethodPlugin.Run/0 | blocked | blocked:P-W6-05 until this class passes [ledger work_item W3] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| api:SCR_DebugLinePlugin.Run/0 | blocked | blocked:P-W6-05 until this class passes [ledger work_item W3] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| api:method/Current file | duplicate-of | duplicate-of:api:ScriptEditor.GetCurrentFile/1 (proposal docs/v2/inbox/w3/remainder.jsonl; api:ScriptEditor.GetCurrentFile/1 at T5, target T5, on 1.9.0.37) | EV-P6-BK1-001 |
| api:method/Cursor line | duplicate-of | duplicate-of:api:ScriptEditor.GetCurrentLine/0 (proposal docs/v2/inbox/w3/remainder.jsonl; api:ScriptEditor.GetCurrentLine/0 at T5, target T5, on 1.9.0.37) | EV-P6-BK1-001 |
| api:method/Line count | duplicate-of | duplicate-of:api:ScriptEditor.GetLinesCount/0 (proposal docs/v2/inbox/w3/remainder.jsonl; api:ScriptEditor.GetLinesCount/0 at T5, target T5, on 1.9.0.37) | EV-P6-BK1-001 |
| api:method/Run external command | duplicate-of | duplicate-of:api:Workbench.RunCmd/2 (proposal docs/v2/inbox/w3/remainder.jsonl; api:Workbench.RunCmd/2 at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:static-method/Exit Workbench | duplicate-of | duplicate-of:api:Workbench.Exit/1 (proposal docs/v2/inbox/w3/remainder.jsonl; api:Workbench.Exit/1 at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| api:static-method/Run shell command | duplicate-of | duplicate-of:api:Workbench.RunCmd/2 (proposal docs/v2/inbox/w3/remainder.jsonl; api:Workbench.RunCmd/2 at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| cli:cli-switch/Module launch | blocked | blocked:P-W6-09 (Workbench launch switch; unmeasured headless) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:cli-switch/Script debugger address%2Fport | blocked | blocked:P-W6-09 (Workbench launch switch; unmeasured headless) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:cli-switch/Script define | blocked | blocked:P-W6-09 (Workbench launch switch; unmeasured headless) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:cli-switch/Silent init | blocked | blocked:P-W6-09 (Workbench launch switch; unmeasured headless) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:cli-switch/Skip script compile on init | blocked | blocked:P-W6-09 (Workbench launch switch; unmeasured headless) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| mcp:mcp-tool/API lookup | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| mcp:mcp-tool/New script from template | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| mcp:mcp-tool/Vanilla script read and browse | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| plugin:SCR_BasicCodeFormatterForcedPlugin | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| plugin:SCR_BasicCodeFormatterPlugin | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| plugin:SCR_BasicCodeFormatterPlugin#button:ButtonCancel | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (dialog button) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SCR_BasicCodeFormatterPlugin#button:ButtonOK | subsumed-by | subsumed-by plugin:SCR_BasicCodeFormatterPlugin (dialog button) (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:SCR_CopyClassAndMethodPlugin | blocked | blocked:P-W6-05 until this class passes its run probe (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:SCR_DebugLinePlugin | blocked | blocked:P-W6-05 until this class passes its run probe (DEC-087 ruling 3) | EV-P6-BK2-003 |
| plugin:plugin/AddonBuildInfoTool "Generate addon.ci-info files" | duplicate-of | duplicate-of:plugin:AddonBuildInfoTool (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:AddonBuildInfoTool at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/Basic Code Formatter - forced (Ctrl+Alt+Shift+K) | duplicate-of | duplicate-of:plugin:SCR_BasicCodeFormatterForcedPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterForcedPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/BuildShoreMap "Build shore map" | duplicate-of | duplicate-of:plugin:BuildShoreMap (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:BuildShoreMap at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/GenerateFlowMaps "Regenerate river flow-maps" | duplicate-of | duplicate-of:plugin:GenerateFlowMaps (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:GenerateFlowMaps at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/ResaveMetaPlugin "Re-Save Meta Tool" | duplicate-of | duplicate-of:plugin:ResaveMetaPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResaveMetaPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/ResavePlugin "Re-Save Tool" | duplicate-of | duplicate-of:plugin:ResavePlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResavePlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/ResourceProcessorPlugin "Batch resource processor" | duplicate-of | duplicate-of:plugin:ResourceProcessorPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceProcessorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/ResourceTestPlugin "ResourceTest Plugin" | duplicate-of | duplicate-of:plugin:ResourceTestPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ResourceTestPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/SCR_BasicCodeFormatterForcedPlugin "Basic Code Formatter - forced" | duplicate-of | duplicate-of:plugin:SCR_BasicCodeFormatterForcedPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterForcedPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/SCR_BasicCodeFormatterPlugin "Basic Code Formatter" | duplicate-of | duplicate-of:plugin:SCR_BasicCodeFormatterPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_BasicCodeFormatterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/SCR_CreateEditablePrefabsPlugin "Create%2FUpdate Selected Editable Prefabs" | duplicate-of | duplicate-of:plugin:SCR_CreateEditablePrefabsPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_CreateEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/SCR_CreateEditablePrefabsPluginResourceManager "Create%2FUpdate Selected Editable Prefabs" | duplicate-of | duplicate-of:plugin:SCR_CreateEditablePrefabsPluginResourceManager (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_CreateEditablePrefabsPluginResourceManager at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/SCR_PrefabValidatorPlugin "Validate Prefabs" | duplicate-of | duplicate-of:plugin:SCR_PrefabValidatorPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_PrefabValidatorPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/SCR_RegisterPlaceableEntitiesPlugin "Register Placeable Entities..." | duplicate-of | duplicate-of:plugin:SCR_RegisterPlaceableEntitiesPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_RegisterPlaceableEntitiesPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/SCR_TerrainEntityVariantReplacementPlugin "Terrain Entity Variant Replacement" | duplicate-of | duplicate-of:plugin:SCR_TerrainEntityVariantReplacementPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_TerrainEntityVariantReplacementPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/SCR_UpdateAllEditablePrefabsPlugin "Update All Editable Prefabs" | duplicate-of | duplicate-of:plugin:SCR_UpdateAllEditablePrefabsPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_UpdateAllEditablePrefabsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/SCR_WorldEntitiesStatisticsPlugin "World Entities Statistics" | duplicate-of | duplicate-of:plugin:SCR_WorldEntitiesStatisticsPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SCR_WorldEntitiesStatisticsPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/SearchXOBPlugin "Search Tool (XOBs)" | duplicate-of | duplicate-of:plugin:SearchXOBPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:SearchXOBPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/ValidateFBXPlugin "Validate Asset" | duplicate-of | duplicate-of:plugin:ValidateFBXPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:ValidateFBXPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/WorldDataExport "World Data Export Plugin" | duplicate-of | duplicate-of:plugin:WorldDataExport (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldDataExport at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/WorldExporterPlugin "Map Exporter" | duplicate-of | duplicate-of:plugin:WorldExporterPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldExporterPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| plugin:plugin/WorldTestPlugin "WorldTest Plugin" | duplicate-of | duplicate-of:plugin:WorldTestPlugin (proposal docs/v2/inbox/w6/remainder.jsonl; plugin:WorldTestPlugin at T2, target T2, on 1.9.0.37) | EV-P6-BK1-001 |
| ui:ScriptEditor/menu-item/File/Exit | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ScriptEditor/menu-item/Plugins/Copy Class and Method Name | blocked | blocked:P-W6-05 until this class passes its run probe [ledger work_item W3] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| ui:ScriptEditor/menu-item/Plugins/Debug Line Shortcut | blocked | blocked:P-W6-05 until this class passes its run probe [ledger work_item W3] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| ui:ScriptEditor/menu-item/Plugins/Settings/Clear All Settings | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ScriptEditor/menu-item/Window/Reset Default Layouts | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| ui:ScriptEditor/shortcut/Script Editor/Exit | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
