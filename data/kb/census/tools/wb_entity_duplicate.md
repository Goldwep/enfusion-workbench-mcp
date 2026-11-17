# Tool: wb_entity_duplicate

Save a placed entity (base-game instances too) as a new .et in your addon with a new GUID, register it, and by default replace the original in the scene, making it editable.

Row: mcp:tool/wb_entity_duplicate. Tier T2/T5.

## Actions (1)

| action | risk | what |
| --- | --- | --- |
| run | mutating | Save a placed entity (base-game instances too) as a new .et in your addon with a new GUID, register it, and by default replace the original in the scene, making it editable. |

## Rows linked to this tool (6)

- mcp:handler-action/EMCP_WB_CreateEntity.run (run read)
- mcp:handler-action/EMCP_WB_DeleteEntity.run (run read)
- mcp:handler-action/EMCP_WB_ModifyEntity.getProperty (run read)
- mcp:handler-action/EMCP_WB_ModifyEntity.getWorldTransform (run read)
- mcp:handler-action/EMCP_WB_Prefabs.getAncestor (run read)
- mcp:handler-action/EMCP_WB_Resources.register (run read)
