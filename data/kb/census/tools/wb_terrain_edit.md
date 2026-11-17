# Tool: wb_terrain_edit

mcp tool 'wb_terrain_edit' in none

Row: mcp:tool/wb_terrain_edit. Tier T2/T2.

## Actions (8)

| action | risk | what |
| --- | --- | --- |
| backup | mutating | mcp action 'wb_terrain_edit.backup' in none under wb_terrain_edit |
| brush | mutating | mcp action 'wb_terrain_edit.brush' in none under wb_terrain_edit |
| exportMasks | mutating | mcp action 'wb_terrain_edit.exportMasks' in none under wb_terrain_edit |
| flatter | mutating | mcp action 'wb_terrain_edit.flatter' in none under wb_terrain_edit |
| maps | mutating | mcp action 'wb_terrain_edit.maps' in none under wb_terrain_edit |
| restore | mutating | mcp action 'wb_terrain_edit.restore' in none under wb_terrain_edit |
| tileRead | mutating | mcp action 'wb_terrain_edit.tileRead' in none under wb_terrain_edit |
| tileWrite | mutating | mcp action 'wb_terrain_edit.tileWrite' in none under wb_terrain_edit |

## Rows linked to this tool (25)

- api:WorldEditorAPI.AddTerrainFlatterEntity/9 (flatter drive)
- api:WorldEditorAPI.BeginTerrainAction/2 (tileWrite drive)
- api:WorldEditorAPI.BuildShoreMap/0 (maps drive)
- api:WorldEditorAPI.EndTerrainAction/1 (tileWrite drive)
- api:WorldEditorAPI.ExportSurfaceMasks/2 (exportMasks drive)
- api:WorldEditorAPI.RegenerateFlowMaps/4 (maps drive)
- api:WorldEditorAPI.RemoveTerrainFlatterEntity/2 (flatter drive)
- api:WorldEditorAPI.SetTerrainSurfaceTile/4 (tileWrite drive)
- mcp:action/wb_terrain_edit.backup (backup drive)
- mcp:action/wb_terrain_edit.brush (brush drive)
- mcp:action/wb_terrain_edit.exportMasks (exportMasks drive)
- mcp:action/wb_terrain_edit.flatter (flatter drive)
- mcp:action/wb_terrain_edit.maps (maps drive)
- mcp:action/wb_terrain_edit.restore (restore drive)
- mcp:action/wb_terrain_edit.tileRead (tileRead drive)
- mcp:action/wb_terrain_edit.tileWrite (tileWrite drive)
- mcp:handler-action/EMCP_WB_TerrainEdit.backup (backup drive)
- mcp:handler-action/EMCP_WB_TerrainEdit.brush (brush drive)
- mcp:handler-action/EMCP_WB_TerrainEdit.exportMasks (exportMasks drive)
- mcp:handler-action/EMCP_WB_TerrainEdit.flatter (flatter drive)
- mcp:handler-action/EMCP_WB_TerrainEdit.maps (maps drive)
- mcp:handler-action/EMCP_WB_TerrainEdit.restore (restore drive)
- mcp:handler-action/EMCP_WB_TerrainEdit.tileRead (tileRead drive, tileRead read)
- mcp:handler-action/EMCP_WB_TerrainEdit.tileWrite (tileWrite drive)
- net:handler/ExportSurfaceMasks (exportMasks drive)
