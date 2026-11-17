# Tool: wb_world

mcp tool 'wb_world' in none

Row: mcp:tool/wb_world. Tier T2/T2.

## Actions (9)

| action | risk | what |
| --- | --- | --- |
| addComment | mutating | mcp action 'wb_world.addComment' in none under wb_world |
| annotate | mutating | mcp action 'wb_world.annotate' in none under wb_world |
| browserSelection | mutating | mcp action 'wb_world.browserSelection' in none under wb_world |
| comments | mutating | mcp action 'wb_world.comments' in none under wb_world |
| play | mutating | mcp action 'wb_world.play' in none under wb_world |
| playEvents | mutating | mcp action 'wb_world.playEvents' in none under wb_world |
| register | mutating | mcp action 'wb_world.register' in none under wb_world |
| state | mutating | mcp action 'wb_world.state' in none under wb_world |
| stop | mutating | mcp action 'wb_world.stop' in none under wb_world |

## Rows linked to this tool (36)

- api:WorldEditor.GetApi/0 (state drive)
- api:WorldEditor.GetResourceBrowserSelection/2 (browserSelection drive)
- api:WorldEditor.SwitchToEditMode/0 (stop drive)
- api:WorldEditor.SwitchToGameMode/2 (play drive)
- api:WorldEditorAPI.AreGeneratorEventsEnabled/0 (state drive)
- api:WorldEditorAPI.GetCommentCategories/1 (comments drive)
- api:WorldEditorAPI.GetCurrentToolName/0 (state drive)
- api:WorldEditorAPI.GetWorldPath/1 (state drive)
- api:WorldEditorAPI.IsCreatingEntityInWindow/0 (state drive)
- api:WorldEditorAPI.IsDoingEditAction/0 (state drive)
- api:WorldEditorAPI.IsEditMode/0 (state drive)
- api:WorldEditorAPI.IsGameMode/0 (state drive)
- api:WorldEditorAPI.IsModifyingData/0 (state drive)
- api:WorldEditorAPI.IsPrefabEditMode/0 (state drive)
- api:WorldEditorAPI.UndoOrRedoIsRestoring/0 (state drive)
- api:WorldEditorPlugin.OnGameModeEnded/0 (playEvents drive)
- api:WorldEditorPlugin.OnGameModeStarted/5 (playEvents drive)
- mcp:action/wb_world.addComment (addComment drive)
- mcp:action/wb_world.annotate (annotate drive)
- mcp:action/wb_world.browserSelection (browserSelection drive)
- mcp:action/wb_world.comments (comments drive)
- mcp:action/wb_world.play (play drive)
- mcp:action/wb_world.playEvents (playEvents drive)
- mcp:action/wb_world.register (register drive)
- mcp:action/wb_world.state (state drive)
- mcp:action/wb_world.stop (stop drive)
- mcp:handler-action/EMCP_WB_World.addComment (addComment drive, addComment read)
- mcp:handler-action/EMCP_WB_World.annotate (annotate drive, annotate read)
- mcp:handler-action/EMCP_WB_World.browserSelection (browserSelection drive, browserSelection read)
- mcp:handler-action/EMCP_WB_World.comments (comments drive, comments read)
- mcp:handler-action/EMCP_WB_World.play (play drive, play read)
- mcp:handler-action/EMCP_WB_World.playEvents (playEvents drive, playEvents read)
- mcp:handler-action/EMCP_WB_World.register (register drive, register read)
- mcp:handler-action/EMCP_WB_World.state (state drive, state read)
- mcp:handler-action/EMCP_WB_World.stop (stop drive, stop read)
- ui:WorldEditor/menu-item/Game/Play Game (play drive)
