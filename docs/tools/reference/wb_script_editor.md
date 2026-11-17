# wb_script_editor

```text
Script Editor: the active file, 0-based lines.
Read:
state: Open file, caret line, line count
getLines: Read lines, paged
Mutating:
open: Open a script in a tab
jump: Go to a symbol's definition
setLine: Replace one line
insertLine: Insert a line before N
removeLine: Remove one line
replaceRange: Replace N lines with new ones
save: Save (confirm; else a dry run)
close: Close the editor (confirm)
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Handler contract | `contracts/EMCP_WB_ScriptEditor.json` (EMCP_WB_ScriptEditor) |
| Census KB page | [data/kb/census/tools/wb_script_editor.md](../../../data/kb/census/tools/wb_script_editor.md) |

## Actions (10)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `state` | no | no | Open file, caret line, line count | none |
| `getLines` | no | no | Read lines, paged | `start` (int), `cursor` (string), `limit` (int) |
| `open` | yes | no | Open a script in a tab | `path`* (string) |
| `jump` | yes | no | Go to a symbol's definition | `symbol`* (string) |
| `setLine` | yes | yes | Replace one line | `line`* (int), `text`* (string) |
| `insertLine` | yes | yes | Insert a line before N | `line`* (int), `text`* (string) |
| `removeLine` | yes | yes | Remove one line | `line`* (int) |
| `replaceRange` | yes | yes | Replace N lines with new ones | `start`* (int), `count`* (int), `lines`* (array<string>), `expected` (array<string>) |
| `save` | yes | yes | Save (confirm; else a dry run) | `confirm` (bool) |
| `close` | yes | no | Close the editor (confirm) Refuses: GATED until probe P-W3-04 passes (W3 OD-3, DEC-063) | `confirm` (bool) |

`*` marks a required parameter of that action.

## Input parameters (13)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | 1.x names still accepted: getCurrentFile, getLine, getLinesCount, openFile One of: `state`, `getLines`, `open`, `jump`, `setLine`, `insertLine`, `removeLine`, `replaceRange`, `save`, `close`, `getCurrentFile`, `getLine`, `getLinesCount`, `openFile`. |
| `start` | integer | no | 0-based first line, default 0 |
| `cursor` | string | no | nextCursor of the previous page |
| `limit` | integer | no | default 100, max 200 |
| `path` | string | no | clean relative .c path |
| `symbol` | string | no | Class or Class.Member |
| `line` | integer | no | 0-based |
| `text` | string | no | no line break |
| `count` | integer | no | lines replaced; 0 inserts |
| `lines` | array<string> | no | new lines; empty deletes |
| `expected` | array<string> | no | current text; else TEXT_CHANGED |
| `confirm` | boolean | no | true saves, else a dry run |
| `oneBased` | boolean | no | 1.x: the line or start number counts from 1 (getLines, setLine, insertLine, removeLine, replaceRange); default is 0-based |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_script_editor.<action>`. A row that links several actions is counted under each (67 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `close` | 2 | T2 1, T3 1 | `mcp:action/wb_script_editor.close`, `mcp:handler-action/EMCP_WB_ScriptEditor.close` |
| `getCurrentFile` | 5 | T0 1, T5 4 | `api:ScriptEditor.GetCurrentFile/1`, `api:ScriptEditor.GetCurrentLine/0`, `api:ScriptEditor.GetLinesCount/0` |
| `getLine` | 3 | T0 1, T5 2 | `api:ScriptEditor.GetLineText/2`, `mcp:action/wb_script_editor.getLine`, `mcp:handler-action/EMCP_WB_ScriptEditor.getLine` |
| `getLines` | 5 | T5 5 | `api:ScriptEditor.GetCurrentFile/1`, `api:ScriptEditor.GetLineText/2`, `api:ScriptEditor.GetLinesCount/0` |
| `getLinesCount` | 3 | T0 1, T5 2 | `api:ScriptEditor.GetLinesCount/0`, `mcp:action/wb_script_editor.getLinesCount`, `mcp:handler-action/EMCP_WB_ScriptEditor.getLinesCount` |
| `insertLine` | 7 | T2 1, T5 6 | `api:ScriptEditor.GetCurrentFile/1`, `api:ScriptEditor.GetLineText/2`, `api:ScriptEditor.GetLinesCount/0` |
| `jump` | 5 | T3 1, T5 4 | `api:ScriptEditor.GetCurrentFile/1`, `api:ScriptEditor.GetCurrentLine/0`, `api:Workbench.JumpToScriptSymbol/1` |
| `open` | 6 | T1 1, T3 1, T5 4 | `api:ScriptEditor.GetCurrentFile/1`, `api:ScriptEditor.GetLinesCount/0`, `api:Workbench.OpenModule/1` |
| `openFile` | 2 | T0 1, T5 1 | `mcp:action/wb_script_editor.openFile`, `mcp:handler-action/EMCP_WB_ScriptEditor.openFile` |
| `removeLine` | 6 | T2 1, T5 5 | `api:ScriptEditor.GetCurrentFile/1`, `api:ScriptEditor.GetLineText/2`, `api:ScriptEditor.GetLinesCount/0` |
| `replaceRange` | 8 | T5 8 | `api:ScriptEditor.GetCurrentFile/1`, `api:ScriptEditor.GetLineText/2`, `api:ScriptEditor.GetLinesCount/0` |
| `save` | 2 | T2 1, T3 1 | `mcp:action/wb_script_editor.save`, `mcp:handler-action/EMCP_WB_ScriptEditor.save` |
| `setLine` | 7 | T2 1, T5 6 | `api:ScriptEditor.GetCurrentFile/1`, `api:ScriptEditor.GetLineText/2`, `api:ScriptEditor.GetLinesCount/0` |
| `state` | 6 | T3 1, T5 5 | `api:ScriptEditor.GetCurrentFile/1`, `api:ScriptEditor.GetCurrentLine/0`, `api:ScriptEditor.GetLinesCount/0` |
