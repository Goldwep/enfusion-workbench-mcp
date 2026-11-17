# Tool: wb_terrain

getHeight, getBounds

Row: mcp:tool/wb_terrain. Tier T2/T2.

## Actions (5)

| action | risk | what |
| --- | --- | --- |
| getBounds | safe | mcp action 'wb_terrain.getBounds' in WorldEditor under wb_terrain |
| getHeight | safe | mcp action 'wb_terrain.getHeight' in WorldEditor under wb_terrain |
| heights | mutating | mcp action 'wb_terrain.heights' in WorldEditor under wb_terrain |
| info | mutating | mcp action 'wb_terrain.info' in WorldEditor under wb_terrain |
| tile | mutating | mcp action 'wb_terrain.tile' in WorldEditor under wb_terrain |

## Rows linked to this tool (20)

- api:SCR_WorldEditorToolHelper.GetTerrainMinMaxY/2 (info drive)
- api:WorldEditor.GetTerrainBounds/2 (info drive)
- api:WorldEditorAPI.GetSurfaceMaterials/2 (info drive)
- api:WorldEditorAPI.GetTerrainResolutionX/1 (info drive)
- api:WorldEditorAPI.GetTerrainResolutionY/1 (info drive)
- api:WorldEditorAPI.GetTerrainSurfaceTile/4 (tile drive)
- api:WorldEditorAPI.GetTerrainTilesX/1 (info drive)
- api:WorldEditorAPI.GetTerrainTilesY/1 (info drive)
- api:WorldEditorAPI.GetTerrainUnitScale/1 (info drive)
- api:WorldEditorAPI.TryGetTerrainSurfaceY/3 (heights drive)
- mcp:action/wb_terrain.getBounds (getBounds drive)
- mcp:action/wb_terrain.getHeight (getHeight drive)
- mcp:action/wb_terrain.heights (heights drive)
- mcp:action/wb_terrain.info (info drive)
- mcp:action/wb_terrain.tile (tile drive)
- mcp:handler-action/EMCP_WB_Terrain.getBounds (getBounds read)
- mcp:handler-action/EMCP_WB_Terrain.getHeight (getHeight read)
- mcp:handler-action/EMCP_WB_Terrain.heights (heights drive, heights read)
- mcp:handler-action/EMCP_WB_Terrain.info (info drive, info read)
- mcp:handler-action/EMCP_WB_Terrain.tile (tile drive, tile read)
