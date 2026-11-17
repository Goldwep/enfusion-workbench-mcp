# Tool: wb_script_editor

getCurrentFile, getLine, setLine, insertLine, removeLine, getLinesCount, openFile

Row: mcp:tool/wb_script_editor. Tier T2/T2.

## Actions (14)

| action | risk | what |
| --- | --- | --- |
| close | mutating | mcp action 'wb_script_editor.close' in ScriptEditor under wb_script_editor |
| getCurrentFile | safe | mcp action 'wb_script_editor.getCurrentFile' in ScriptEditor under wb_script_editor |
| getLine | safe | mcp action 'wb_script_editor.getLine' in ScriptEditor under wb_script_editor |
| getLines | safe | mcp action 'wb_script_editor.getLines' in ScriptEditor under wb_script_editor |
| getLinesCount | safe | mcp action 'wb_script_editor.getLinesCount' in ScriptEditor under wb_script_editor |
| insertLine | mutating | mcp action 'wb_script_editor.insertLine' in ScriptEditor under wb_script_editor |
| jump | mutating | mcp action 'wb_script_editor.jump' in ScriptEditor under wb_script_editor |
| open | mutating | mcp action 'wb_script_editor.open' in ScriptEditor under wb_script_editor |
| openFile | mutating | mcp action 'wb_script_editor.openFile' in ScriptEditor under wb_script_editor |
| removeLine | mutating | mcp action 'wb_script_editor.removeLine' in ScriptEditor under wb_script_editor |
| replaceRange | mutating | mcp action 'wb_script_editor.replaceRange' in ScriptEditor under wb_script_editor |
| save | mutating | mcp action 'wb_script_editor.save' in ScriptEditor under wb_script_editor |
| setLine | mutating | mcp action 'wb_script_editor.setLine' in ScriptEditor under wb_script_editor |
| state | mutating | mcp action 'wb_script_editor.state' in ScriptEditor under wb_script_editor |

## Rows linked to this tool (39)

- api:ScriptEditor.GetCurrentFile/1 (getCurrentFile drive, getLines drive, insertLine drive, jump drive, open drive, removeLine drive, replaceRange drive, setLine drive, state drive)
- api:ScriptEditor.GetCurrentLine/0 (getCurrentFile drive, jump drive, state drive)
- api:ScriptEditor.GetLineText/2 (getLine drive, getLines drive, insertLine drive, removeLine drive, replaceRange drive, setLine drive)
- api:ScriptEditor.GetLinesCount/0 (getCurrentFile drive, getLines drive, getLinesCount drive, insertLine drive, open drive, removeLine drive, replaceRange drive, setLine drive, state drive)
- api:ScriptEditor.InsertLine/2 (insertLine drive, replaceRange drive)
- api:ScriptEditor.RemoveLine/1 (insertLine drive, removeLine drive, replaceRange drive, setLine drive)
- api:ScriptEditor.SetLineText/2 (replaceRange drive, setLine drive)
- api:Workbench.GetModule/1 (state read)
- api:Workbench.JumpToScriptSymbol/1 (jump drive)
- api:Workbench.OpenModule/1 (open drive)
- mcp:action/wb_script_editor.close (close drive)
- mcp:action/wb_script_editor.getCurrentFile (getCurrentFile drive)
- mcp:action/wb_script_editor.getLine (getLine drive)
- mcp:action/wb_script_editor.getLines (getLines drive)
- mcp:action/wb_script_editor.getLinesCount (getLinesCount drive)
- mcp:action/wb_script_editor.insertLine (insertLine drive)
- mcp:action/wb_script_editor.jump (jump drive)
- mcp:action/wb_script_editor.open (open drive)
- mcp:action/wb_script_editor.openFile (openFile drive)
- mcp:action/wb_script_editor.removeLine (removeLine drive)
- mcp:action/wb_script_editor.replaceRange (replaceRange drive)
- mcp:action/wb_script_editor.save (save drive)
- mcp:action/wb_script_editor.setLine (setLine drive)
- mcp:action/wb_script_editor.state (state drive)
- mcp:handler-action/EMCP_WB_ScriptEditor.close (close read)
- mcp:handler-action/EMCP_WB_ScriptEditor.getCurrentFile (getCurrentFile read)
- mcp:handler-action/EMCP_WB_ScriptEditor.getLine (getLine read)
- mcp:handler-action/EMCP_WB_ScriptEditor.getLines (getLines drive, getLines read)
- mcp:handler-action/EMCP_WB_ScriptEditor.getLinesCount (getLinesCount read)
- mcp:handler-action/EMCP_WB_ScriptEditor.insertLine (insertLine read)
- mcp:handler-action/EMCP_WB_ScriptEditor.jump (jump drive, jump read)
- mcp:handler-action/EMCP_WB_ScriptEditor.open (open drive, open read)
- mcp:handler-action/EMCP_WB_ScriptEditor.openFile (openFile read)
- mcp:handler-action/EMCP_WB_ScriptEditor.removeLine (removeLine read)
- mcp:handler-action/EMCP_WB_ScriptEditor.replaceRange (replaceRange drive, replaceRange read)
- mcp:handler-action/EMCP_WB_ScriptEditor.save (save read)
- mcp:handler-action/EMCP_WB_ScriptEditor.setLine (setLine read)
- mcp:handler-action/EMCP_WB_ScriptEditor.state (state drive, state read)
- ui:ScriptEditor/module/ScriptEditor (open drive)
