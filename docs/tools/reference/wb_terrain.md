# wb_terrain

```text
Terrain of the open world, read only: facts, heights, height tiles.
Read:
info: Resolution, tiles, unit scale, bounds, min/max, land area, surfaces
heights: Terrain height at up to 200 points; onTerrain per point
tile: Height samples of one tile, paged
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Handler contract | `contracts/EMCP_WB_Terrain.json` (EMCP_WB_Terrain) |
| Census KB page | [data/kb/census/tools/wb_terrain.md](../../../data/kb/census/tools/wb_terrain.md) |

## Actions (6)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `info` | no | no | Resolution, tiles, unit scale, bounds, min/max, land area, surfaces | `terrainIndex` (int), `landArea` (bool), `minMax` (bool) |
| `heights` | no | no | Terrain height at up to 200 points; onTerrain per point | `points`* (array<string>) |
| `tile` | no | no | Height samples of one tile, paged | `tileX`* (int), `tileY`* (int), `terrainIndex` (int), `cursor` (string), `limit` (int) |
| `inspect` | no | no | 1.x terrain_inspect: bounds, world_path and open_world as a JSON payload | `world_path`* (string) |
| `navmesh_status` | no | no | 1.x terrain_navmesh_status: not implemented Refuses: 1.x placeholder kept as 1.x answered it: status error, message "not implemented: ..."; nothing is read. | `world_path` (string) |
| `road_export_graph` | no | no | 1.x terrain_road_export_graph: not implemented Refuses: 1.x placeholder kept as 1.x answered it: status error, message "not implemented: ..."; nothing is read. | `world_path` (string) |

`*` marks a required parameter of that action.

## Input parameters (11)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | 1.x names still accepted: getHeight, getBounds One of: `info`, `heights`, `tile`, `getHeight`, `getBounds`. |
| `terrainIndex` | integer | no | default 0 |
| `landArea` | boolean | no | compute land area (slow) |
| `minMax` | boolean | no | compute minY/maxY (slow) |
| `points` | array<string> | no | "x z" each, max 200 |
| `tileX` | integer | no |  |
| `tileY` | integer | no |  |
| `cursor` | string | no | nextCursor of the previous page |
| `limit` | integer | no | default 50, max 200 |
| `x` | number | no | 1.x getHeight: world X |
| `z` | number | no | 1.x getHeight: world Z |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_terrain.<action>`. A row that links several actions is counted under each (20 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `getBounds` | 2 | T0 1, T4 1 | `mcp:action/wb_terrain.getBounds`, `mcp:handler-action/EMCP_WB_Terrain.getBounds` |
| `getHeight` | 2 | T0 1, T4 1 | `mcp:action/wb_terrain.getHeight`, `mcp:handler-action/EMCP_WB_Terrain.getHeight` |
| `heights` | 3 | T5 3 | `api:WorldEditorAPI.TryGetTerrainSurfaceY/3`, `mcp:action/wb_terrain.heights`, `mcp:handler-action/EMCP_WB_Terrain.heights` |
| `info` | 10 | T5 10 | `api:SCR_WorldEditorToolHelper.GetTerrainMinMaxY/2`, `api:WorldEditor.GetTerrainBounds/2`, `api:WorldEditorAPI.GetSurfaceMaterials/2` |
| `tile` | 3 | T5 3 | `api:WorldEditorAPI.GetTerrainSurfaceTile/4`, `mcp:action/wb_terrain.tile`, `mcp:handler-action/EMCP_WB_Terrain.tile` |
