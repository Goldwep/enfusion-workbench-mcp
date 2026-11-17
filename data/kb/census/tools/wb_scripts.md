# Tool: wb_scripts

Script compile train through Workbench's natives.

Row: mcp:tool/wb_scripts. Tier T2/T2.

## Actions (3)

| action | risk | what |
| --- | --- | --- |
| reload | mutating | mcp action 'wb_scripts.reload' in none under wb_scripts |
| status | safe | mcp action 'wb_scripts.status' in none under wb_scripts |
| validate | mutating | mcp action 'wb_scripts.validate' in none under wb_scripts |

## Rows linked to this tool (10)

- mcp:action/wb_scripts.reload (reload drive)
- mcp:action/wb_scripts.status (status drive)
- mcp:action/wb_scripts.validate (validate drive)
- mcp:handler-action/EMCP_WB_Ping.run (reload read, status read, validate read)
- net:native/IsWorkbenchRunning (reload read, status read, validate read)
- net:native/IsWorldEditorRunning (status read)
- net:native/ReloadScripts (reload read)
- net:native/ValidateScripts (validate read)
- ui:ScriptEditor/menu-item/Build/PC (validate drive)
- ui:ScriptEditor/menu-item/Build/WORKBENCH (validate drive)
