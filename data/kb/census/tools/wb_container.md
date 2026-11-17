# Tool: wb_container

mcp tool 'wb_container' in none

Row: mcp:tool/wb_container. Tier T2/T2.

## Actions (9)

| action | risk | what |
| --- | --- | --- |
| arrayAdd | mutating | mcp action 'wb_container.arrayAdd' in none under wb_container |
| arrayMove | mutating | mcp action 'wb_container.arrayMove' in none under wb_container |
| arrayRemove | mutating | mcp action 'wb_container.arrayRemove' in none under wb_container |
| clear | mutating | mcp action 'wb_container.clear' in none under wb_container |
| describe | safe | mcp action 'wb_container.describe' in none under wb_container |
| get | safe | mcp action 'wb_container.get' in none under wb_container |
| save | mutating | mcp action 'wb_container.save' in none under wb_container |
| set | mutating | mcp action 'wb_container.set' in none under wb_container |
| setClass | mutating | mcp action 'wb_container.setClass' in none under wb_container |

## Rows linked to this tool (25)

- api:WBModuleDef.GetContainer/1 (describe read)
- api:WBModuleDef.GetNumContainers/0 (describe read)
- api:WBModuleDef.Save/0 (save drive)
- api:WorldEditorAPI.ChangeObjectClass/3 (setClass drive)
- api:WorldEditorAPI.ClearVariableValue/3 (clear drive)
- api:WorldEditorAPI.CreateObjectArrayVariableMember/5 (arrayAdd drive)
- api:WorldEditorAPI.RemoveObjectArrayVariableMember/4 (arrayRemove drive)
- mcp:action/wb_container.arrayAdd (arrayAdd drive)
- mcp:action/wb_container.arrayMove (arrayMove drive)
- mcp:action/wb_container.arrayRemove (arrayRemove drive)
- mcp:action/wb_container.clear (clear drive)
- mcp:action/wb_container.describe (describe drive)
- mcp:action/wb_container.get (get drive)
- mcp:action/wb_container.save (save drive)
- mcp:action/wb_container.set (set drive)
- mcp:action/wb_container.setClass (setClass drive)
- mcp:handler-action/EMCP_WB_Container.arrayAdd (arrayAdd drive, arrayAdd read)
- mcp:handler-action/EMCP_WB_Container.arrayMove (arrayMove drive, arrayMove read)
- mcp:handler-action/EMCP_WB_Container.arrayRemove (arrayRemove drive, arrayRemove read)
- mcp:handler-action/EMCP_WB_Container.clear (clear drive, clear read)
- mcp:handler-action/EMCP_WB_Container.describe (describe drive, describe read)
- mcp:handler-action/EMCP_WB_Container.get (get drive, get read)
- mcp:handler-action/EMCP_WB_Container.save (save drive, save read)
- mcp:handler-action/EMCP_WB_Container.set (set drive, set read)
- mcp:handler-action/EMCP_WB_Container.setClass (setClass drive, setClass read)
