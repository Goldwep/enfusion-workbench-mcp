# Tool: wb_view

mcp tool 'wb_view' in WorldEditor

Row: mcp:tool/wb_view. Tier T2/T2.

## Actions (9)

| action | risk | what |
| --- | --- | --- |
| camera | mutating | mcp action 'wb_view.camera' in WorldEditor under wb_view |
| focus | mutating | mcp action 'wb_view.focus' in WorldEditor under wb_view |
| placeAtPixel | mutating | mcp action 'wb_view.placeAtPixel' in WorldEditor under wb_view |
| select | mutating | mcp action 'wb_view.select' in WorldEditor under wb_view |
| selection | mutating | mcp action 'wb_view.selection' in WorldEditor under wb_view |
| setCamera | mutating | mcp action 'wb_view.setCamera' in WorldEditor under wb_view |
| setVisible | mutating | mcp action 'wb_view.setVisible' in WorldEditor under wb_view |
| trace | mutating | mcp action 'wb_view.trace' in WorldEditor under wb_view |
| underCursor | mutating | mcp action 'wb_view.underCursor' in WorldEditor under wb_view |

## Rows linked to this tool (44)

- api:WorldEditorAPI.AddToEntitySelection/1 (select drive)
- api:WorldEditorAPI.ClearEntitySelection/0 (select drive)
- api:WorldEditorAPI.CreateEntityInWindowEx/6 (placeAtPixel drive)
- api:WorldEditorAPI.GetEntityUnderCursor/0 (underCursor drive)
- api:WorldEditorAPI.GetMousePosX/1 (underCursor drive)
- api:WorldEditorAPI.GetMousePosY/1 (underCursor drive)
- api:WorldEditorAPI.GetScreenHeight/0 (camera drive)
- api:WorldEditorAPI.GetScreenWidth/0 (camera drive)
- api:WorldEditorAPI.GetSelectedEntitiesCount/0 (selection drive)
- api:WorldEditorAPI.GetSelectedEntity/1 (selection drive)
- api:WorldEditorAPI.GetWorld/0 (camera drive)
- api:WorldEditorAPI.IsEntitySelected/1 (selection drive)
- api:WorldEditorAPI.IsEntitySelectedAsMain/1 (selection drive)
- api:WorldEditorAPI.IsEntityVisible/1 (setVisible drive)
- api:WorldEditorAPI.RemoveFromEntitySelection/1 (select drive)
- api:WorldEditorAPI.SetCamera/2 (setCamera drive)
- api:WorldEditorAPI.SetEntitySelection/1 (select drive)
- api:WorldEditorAPI.SetEntityVisible/3 (setVisible drive)
- api:WorldEditorAPI.TraceWorldPos/7 (trace drive)
- api:WorldEditorAPI.UpdateSelectionGui/0 (select drive)
- mcp:action/wb_view.camera (camera drive)
- mcp:action/wb_view.focus (focus drive)
- mcp:action/wb_view.placeAtPixel (placeAtPixel drive)
- mcp:action/wb_view.select (select drive)
- mcp:action/wb_view.selection (selection drive)
- mcp:action/wb_view.setCamera (setCamera drive)
- mcp:action/wb_view.setVisible (setVisible drive)
- mcp:action/wb_view.trace (trace drive)
- mcp:action/wb_view.underCursor (underCursor drive)
- mcp:handler-action/EMCP_WB_View.camera (camera drive, camera read)
- mcp:handler-action/EMCP_WB_View.focus (focus drive, focus read)
- mcp:handler-action/EMCP_WB_View.placeAtPixel (placeAtPixel drive, placeAtPixel read)
- mcp:handler-action/EMCP_WB_View.select (select drive, select read)
- mcp:handler-action/EMCP_WB_View.selection (selection drive, selection read)
- mcp:handler-action/EMCP_WB_View.setCamera (setCamera drive, setCamera read)
- mcp:handler-action/EMCP_WB_View.setVisible (setVisible drive, setVisible read)
- mcp:handler-action/EMCP_WB_View.trace (trace drive, trace read)
- mcp:handler-action/EMCP_WB_View.underCursor (underCursor drive, underCursor read)
- ui:WorldEditor/context-item/Hierarchy/entity/Focus Selection (focus drive)
- ui:WorldEditor/context-item/Hierarchy/entity/Hide%2FShow (setVisible drive)
- ui:WorldEditor/context-item/Viewport/Focus Selection (focus drive)
- ui:WorldEditor/context-item/Viewport/Hide%2FShow (setVisible drive)
- ui:WorldEditor/menu-item/Entities/Focus Selection (focus drive)
- ui:WorldEditor/menu-item/Entities/Hide%2FShow (setVisible drive)
