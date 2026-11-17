# Tool: wb_prefabs

createTemplate, save, getGuid, locate, getAncestor

Row: mcp:tool/wb_prefabs. Tier T2/T2.

## Actions (11)

| action | risk | what |
| --- | --- | --- |
| addMembers | mutating | mcp action 'wb_prefabs.addMembers' in none under wb_prefabs |
| clone | mutating | mcp action 'wb_prefabs.clone' in none under wb_prefabs |
| createChild | mutating | mcp action 'wb_prefabs.createChild' in none under wb_prefabs |
| createTemplate | mutating | mcp action 'wb_prefabs.createTemplate' in none under wb_prefabs |
| editState | mutating | mcp action 'wb_prefabs.editState' in none under wb_prefabs |
| getAncestor | safe | mcp action 'wb_prefabs.getAncestor' in none under wb_prefabs |
| getGuid | safe | mcp action 'wb_prefabs.getGuid' in none under wb_prefabs |
| locate | safe | mcp action 'wb_prefabs.locate' in none under wb_prefabs |
| moveToPrefab | mutating | mcp action 'wb_prefabs.moveToPrefab' in none under wb_prefabs |
| removeMembers | mutating | mcp action 'wb_prefabs.removeMembers' in none under wb_prefabs |
| save | mutating | mcp action 'wb_prefabs.save' in none under wb_prefabs |

## Rows linked to this tool (35)

- api:SCR_WorldEditorToolHelper.GetPrefabEditModeEntitySource/0 (editState drive)
- api:WorldEditor.IsPrefabEditMode/0 (editState drive)
- api:WorldEditorAPI.AddPrefabMembers/2 (addMembers drive)
- api:WorldEditorAPI.CreateEntityTemplate/2 (createTemplate drive)
- api:WorldEditorAPI.MoveEntitiesToPrefab/4 (moveToPrefab drive)
- api:WorldEditorAPI.RemovePrefabMembers/1 (removeMembers drive)
- api:WorldEditorAPI.SaveEntityTemplate/1 (save drive)
- mcp:action/wb_prefabs.addMembers (addMembers drive)
- mcp:action/wb_prefabs.clone (clone drive)
- mcp:action/wb_prefabs.createChild (createChild drive)
- mcp:action/wb_prefabs.createTemplate (createTemplate drive)
- mcp:action/wb_prefabs.editState (editState drive)
- mcp:action/wb_prefabs.getAncestor (getAncestor drive)
- mcp:action/wb_prefabs.getGuid (getGuid drive)
- mcp:action/wb_prefabs.locate (locate drive)
- mcp:action/wb_prefabs.moveToPrefab (moveToPrefab drive)
- mcp:action/wb_prefabs.removeMembers (removeMembers drive)
- mcp:action/wb_prefabs.save (save drive)
- mcp:handler-action/EMCP_WB_Prefabs.addMembers (addMembers drive, addMembers read)
- mcp:handler-action/EMCP_WB_Prefabs.clone (clone drive, clone read)
- mcp:handler-action/EMCP_WB_Prefabs.createChild (createChild drive, createChild read)
- mcp:handler-action/EMCP_WB_Prefabs.createTemplate (createTemplate drive, createTemplate read)
- mcp:handler-action/EMCP_WB_Prefabs.editState (editState drive, editState read)
- mcp:handler-action/EMCP_WB_Prefabs.getAncestor (getAncestor drive, getAncestor read)
- mcp:handler-action/EMCP_WB_Prefabs.moveToPrefab (moveToPrefab drive, moveToPrefab read)
- mcp:handler-action/EMCP_WB_Prefabs.removeMembers (removeMembers drive, removeMembers read)
- mcp:handler-action/EMCP_WB_Prefabs.save (save drive, save read)
- net:handler/GetPrefabGUID (getGuid read)
- net:handler/LocatePrefabsFromPath (locate read)
- net:handler/LocateProject (locate read)
- ui:WorldEditor/context-item/Hierarchy/entity/Apply Changes to Prefab (save drive)
- ui:WorldEditor/context-item/Viewport/Apply Changes to Prefab (save drive)
- ui:WorldEditor/menu-item/Entities/Add Child Prefab/To Prefab (addMembers drive)
- ui:WorldEditor/menu-item/Entities/Apply Changes to Prefab (save drive)
- ui:WorldEditor/menu-item/Entities/Delete/From Prefab Shift+Delete (removeMembers drive)
