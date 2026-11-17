# Tool: wb_layers

list, getActive, getEntityLayer, isVisible, getInfo, toggleLock

Row: mcp:tool/wb_layers. Tier T2/T2.

## Actions (15)

| action | risk | what |
| --- | --- | --- |
| create | mutating | mcp action 'wb_layers.create' in WorldEditor under wb_layers |
| createFolder | mutating | mcp action 'wb_layers.createFolder' in WorldEditor under wb_layers |
| delete | mutating | mcp action 'wb_layers.delete' in WorldEditor under wb_layers |
| getActive | safe | mcp action 'wb_layers.getActive' in WorldEditor under wb_layers |
| getEntityLayer | safe | mcp action 'wb_layers.getEntityLayer' in WorldEditor under wb_layers |
| getInfo | safe | mcp action 'wb_layers.getInfo' in WorldEditor under wb_layers |
| isVisible | safe | mcp action 'wb_layers.isVisible' in WorldEditor under wb_layers |
| list | safe | mcp action 'wb_layers.list' in WorldEditor under wb_layers |
| lock | mutating | mcp action 'wb_layers.lock' in WorldEditor under wb_layers |
| move | mutating | mcp action 'wb_layers.move' in WorldEditor under wb_layers |
| rename | mutating | mcp action 'wb_layers.rename' in WorldEditor under wb_layers |
| setActive | mutating | mcp action 'wb_layers.setActive' in WorldEditor under wb_layers |
| toggleLock | mutating | mcp action 'wb_layers.toggleLock' in WorldEditor under wb_layers |
| tree | mutating | mcp action 'wb_layers.tree' in WorldEditor under wb_layers |
| unlock | mutating | mcp action 'wb_layers.unlock' in WorldEditor under wb_layers |

## Rows linked to this tool (54)

- api:WorldEditorAPI.CreateSubsceneFolder/3 (createFolder drive)
- api:WorldEditorAPI.CreateSubsceneLayer/3 (create drive)
- api:WorldEditorAPI.DeleteSubsceneFolder/2 (delete drive)
- api:WorldEditorAPI.GetActiveSubsceneLayer/1 (tree drive)
- api:WorldEditorAPI.GetCurrentEntityLayerId/0 (tree drive)
- api:WorldEditorAPI.GetCurrentSubScene/0 (tree drive)
- api:WorldEditorAPI.GetNumSubScenes/0 (tree drive)
- api:WorldEditorAPI.GetSubsceneFolders/2 (tree drive)
- api:WorldEditorAPI.GetSubsceneLayerId/2 (tree drive)
- api:WorldEditorAPI.GetSubsceneLayerPath/2 (tree drive)
- api:WorldEditorAPI.IsEntityLayerLocked/2 (tree drive)
- api:WorldEditorAPI.IsEntityLayerLockedHierarchy/2 (tree drive)
- api:WorldEditorAPI.IsEntityLayerVisible/2 (tree drive)
- api:WorldEditorAPI.IsSubsceneLayerVisible/2 (tree drive)
- api:WorldEditorAPI.LockEntityLayer/2 (lock drive)
- api:WorldEditorAPI.RenameSubsceneFolder/3 (rename drive)
- api:WorldEditorAPI.SetActiveSubsceneLayer/2 (setActive drive)
- api:WorldEditorAPI.SetSubsceneFolderParent/3 (move drive)
- api:WorldEditorAPI.UnlockEntityLayer/2 (lock drive)
- mcp:action/wb_layers.create (create drive)
- mcp:action/wb_layers.createFolder (createFolder drive)
- mcp:action/wb_layers.delete (delete drive)
- mcp:action/wb_layers.getActive (getActive drive)
- mcp:action/wb_layers.getEntityLayer (getEntityLayer drive)
- mcp:action/wb_layers.getInfo (getInfo drive)
- mcp:action/wb_layers.isVisible (isVisible drive)
- mcp:action/wb_layers.list (list drive)
- mcp:action/wb_layers.lock (lock drive)
- mcp:action/wb_layers.move (move drive)
- mcp:action/wb_layers.rename (rename drive)
- mcp:action/wb_layers.setActive (setActive drive)
- mcp:action/wb_layers.toggleLock (toggleLock drive)
- mcp:action/wb_layers.tree (tree drive)
- mcp:action/wb_layers.unlock (unlock drive)
- mcp:handler-action/EMCP_WB_Layers.create (create drive, create read)
- mcp:handler-action/EMCP_WB_Layers.createFolder (createFolder drive, createFolder read)
- mcp:handler-action/EMCP_WB_Layers.delete (delete drive, delete read)
- mcp:handler-action/EMCP_WB_Layers.getActive (getActive read)
- mcp:handler-action/EMCP_WB_Layers.getEntityLayer (getEntityLayer read)
- mcp:handler-action/EMCP_WB_Layers.getInfo (getInfo read)
- mcp:handler-action/EMCP_WB_Layers.isVisible (isVisible read)
- mcp:handler-action/EMCP_WB_Layers.list (list drive, list read)
- mcp:handler-action/EMCP_WB_Layers.lock (lock drive, lock read)
- mcp:handler-action/EMCP_WB_Layers.move (move drive, move read)
- mcp:handler-action/EMCP_WB_Layers.rename (rename drive, rename read)
- mcp:handler-action/EMCP_WB_Layers.setActive (setActive drive, setActive read)
- mcp:handler-action/EMCP_WB_Layers.toggleLock (toggleLock read)
- mcp:handler-action/EMCP_WB_Layers.tree (tree drive, tree read)
- mcp:handler-action/EMCP_WB_Layers.unlock (unlock drive, unlock read)
- ui:WorldEditor/context-item/Hierarchy/default/Lock (lock drive)
- ... 4 more
