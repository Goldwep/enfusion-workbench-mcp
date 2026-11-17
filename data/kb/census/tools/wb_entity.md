# Tool: wb_entity

mcp tool 'wb_entity' in WorldEditor

Row: mcp:tool/wb_entity. Tier T2/T2.

## Actions (12)

| action | risk | what |
| --- | --- | --- |
| children | mutating | mcp action 'wb_entity.children' in WorldEditor under wb_entity |
| clone | mutating | mcp action 'wb_entity.clone' in WorldEditor under wb_entity |
| create | mutating | mcp action 'wb_entity.create' in WorldEditor under wb_entity |
| delete | mutating | mcp action 'wb_entity.delete' in WorldEditor under wb_entity |
| get | safe | mcp action 'wb_entity.get' in WorldEditor under wb_entity |
| list | safe | mcp action 'wb_entity.list' in WorldEditor under wb_entity |
| parent | mutating | mcp action 'wb_entity.parent' in WorldEditor under wb_entity |
| query | safe | mcp action 'wb_entity.query' in WorldEditor under wb_entity |
| rename | mutating | mcp action 'wb_entity.rename' in WorldEditor under wb_entity |
| setLayer | mutating | mcp action 'wb_entity.setLayer' in WorldEditor under wb_entity |
| transform | mutating | mcp action 'wb_entity.transform' in WorldEditor under wb_entity |
| unparent | mutating | mcp action 'wb_entity.unparent' in WorldEditor under wb_entity |

## Rows linked to this tool (58)

- api:WorldEditorAPI.BeginEntityAction/3 (create drive)
- api:WorldEditorAPI.CreateClonedEntity/4 (clone drive)
- api:WorldEditorAPI.CreateEntity/6 (create drive)
- api:WorldEditorAPI.CreateEntityExt/7 (create drive)
- api:WorldEditorAPI.DeleteEntities/1 (delete drive)
- api:WorldEditorAPI.DeleteEntity/1 (delete drive)
- api:WorldEditorAPI.EndEntityAction/1 (create drive)
- api:WorldEditorAPI.EntityToSource/1 (get drive)
- api:WorldEditorAPI.FindEntityByName/1 (list drive)
- api:WorldEditorAPI.GetEditorEntity/1 (list drive)
- api:WorldEditorAPI.GetEditorEntityCount/0 (list drive)
- api:WorldEditorAPI.GetEntityNiceName/1 (get drive)
- api:WorldEditorAPI.GetEntitySubsceneLayer/2 (get drive)
- api:WorldEditorAPI.ParentEntities/3 (parent drive)
- api:WorldEditorAPI.ParentEntity/3 (parent drive)
- api:WorldEditorAPI.RemoveEntityFromParent/1 (unparent drive)
- api:WorldEditorAPI.RenameEntity/2 (rename drive)
- api:WorldEditorAPI.SetEntitySubsceneLayer/3 (setLayer drive)
- api:WorldEditorAPI.SetVariableValue/4 (transform drive)
- api:WorldEditorAPI.SourceToEntity/1 (list drive)
- mcp:action/wb_entity.children (children drive)
- mcp:action/wb_entity.clone (clone drive)
- mcp:action/wb_entity.create (create drive)
- mcp:action/wb_entity.delete (delete drive)
- mcp:action/wb_entity.get (get drive)
- mcp:action/wb_entity.list (list drive)
- mcp:action/wb_entity.parent (parent drive)
- mcp:action/wb_entity.query (query drive)
- mcp:action/wb_entity.rename (rename drive)
- mcp:action/wb_entity.setLayer (setLayer drive)
- mcp:action/wb_entity.transform (transform drive)
- mcp:action/wb_entity.unparent (unparent drive)
- mcp:handler-action/EMCP_WB_Entity.children (children drive, children read)
- mcp:handler-action/EMCP_WB_Entity.clone (clone drive, clone read)
- mcp:handler-action/EMCP_WB_Entity.create (create drive, create read)
- mcp:handler-action/EMCP_WB_Entity.delete (delete drive, delete read)
- mcp:handler-action/EMCP_WB_Entity.get (get drive, get read)
- mcp:handler-action/EMCP_WB_Entity.list (list drive, list read)
- mcp:handler-action/EMCP_WB_Entity.parent (parent drive, parent read)
- mcp:handler-action/EMCP_WB_Entity.query (query drive, query read)
- mcp:handler-action/EMCP_WB_Entity.rename (rename drive, rename read)
- mcp:handler-action/EMCP_WB_Entity.setLayer (setLayer drive, setLayer read)
- mcp:handler-action/EMCP_WB_Entity.transform (transform drive, transform read)
- mcp:handler-action/EMCP_WB_Entity.unparent (unparent drive, unparent read)
- ui:WorldEditor/context-item/Hierarchy/entity/Remove from Parent (unparent drive)
- ui:WorldEditor/context-item/Hierarchy/entity/Rename (rename drive)
- ui:WorldEditor/context-item/Hierarchy/entity/Set Layer (setLayer drive)
- ui:WorldEditor/context-item/Hierarchy/entity/Set Parent (parent drive)
- ui:WorldEditor/context-item/Viewport/Remove from Parent (unparent drive)
- ui:WorldEditor/context-item/Viewport/Rename (rename drive)
- ... 8 more
