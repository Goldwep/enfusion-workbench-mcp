# wb_terrain_edit

```text
Terrain writes on the open project world; each is a dry run unless confirm.
Read:
tileRead: Packed height rows of a tile
Mutating:
tileWrite: Height runs, one undo
brush: (TS) sculpt, flatten, smooth, noise
flatter: Add or remove a flattener
maps: Shore or flow maps, saved
exportMasks: Surface masks to a folder
backup: (TS) terrain files to artifacts
restore: (TS) put a backup back
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Handler contract | `contracts/EMCP_WB_TerrainEdit.json` (EMCP_WB_TerrainEdit) |
| Census KB page | [data/kb/census/tools/wb_terrain_edit.md](../../../data/kb/census/tools/wb_terrain_edit.md) |

## Actions (8)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `tileRead` | no | no | Packed height rows of a tile | `tileX`* (int), `tileY`* (int), `terrainIndex` (int), `cursor` (string), `limit` (int) |
| `tileWrite` | yes | yes | Height runs, one undo Refuses: GATED until P-W7-01 (U18) passes, and outside _throwaway/ (DEC-075); NO_BACKUP until backup ran; NOT_IN_PROJECT for a world outside the project. | `patches`* (array<string>), `undoLabel` (string), `terrainIndex` (int), `confirm` (bool) |
| `brush` | yes | yes | (TS) sculpt, flatten, smooth, noise Refuses: Served by the TS tool: tileRead, brush maths in src/formats/terrain-brush.ts, then tileWrite. GATED and NO_BACKUP as tileWrite. | `centre`* (string), `radius`* (string), `strength` (string), `falloff` (string), `mode`* (string), `delta` (string), `height` (string), `passes` (int), `scale` (string), `seed` (int), `terrainIndex` (int), `confirm` (bool) |
| `flatter` | yes | yes | Add or remove a flattener Refuses: GATED until P-W7-06 passes, and outside _throwaway/ (DEC-075). | `op`* (string), `entity`* (string), `mins` (string), `maxs` (string), `priority` (int), `falloffStart` (string), `falloff` (string), `confirm` (bool) |
| `maps` | yes | yes | Shore or flow maps, saved Refuses: GATED until P-W7-07 passes, and outside _throwaway/ (DEC-075); overwrites the world map files (no undo). | `kind`* (string), `preview` (bool), `confirm` (bool) |
| `exportMasks` | yes | yes | Surface masks to a folder Refuses: GATED until P-W7-08 passes; the engine writes the files, the handler does not. | `directory`* (string), `terrainIndex` (int), `confirm` (bool) |
| `backup` | yes | yes | (TS) terrain files to artifacts Refuses: Served by the TS tool: copies the terrain files P-W7-03 names to the artifacts folder; no handler call. | `label` (string) |
| `restore` | yes | yes | (TS) put a backup back Refuses: Served by the TS tool: refuses WORLD_OPEN while the world is open; copies the backup over the terrain files. | `backupId`* (string), `confirm` (bool) |

`*` marks a required parameter of that action.

## Input parameters (30)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `tileRead`, `tileWrite`, `brush`, `flatter`, `maps`, `exportMasks`, `backup`, `restore`. |
| `tileX` | integer | no |  |
| `tileY` | integer | no |  |
| `terrainIndex` | integer | no |  |
| `cursor` | string | no |  |
| `limit` | integer | no | default 16, max 64 |
| `patches` | array<string> | no | "tx ty row col\|v v ...", max 64 |
| `undoLabel` | string | no | undo name suffix |
| `confirm` | boolean | no | else a dry run |
| `centre` | string | no | "x z" world |
| `radius` | string | no | metres |
| `strength` | string | no | 0..1, default 0.5 |
| `falloff` | string | no | linear\|smooth\|none |
| `mode` | string | no | sculpt\|flatten\|smooth\|noise |
| `delta` | string | no | metres; signed for sculpt |
| `height` | string | no | flatten: metres |
| `passes` | integer | no | smooth: 1..8, default 1 |
| `scale` | string | no | noise: period, metres |
| `seed` | integer | no |  |
| `op` | string | no | add\|remove |
| `entity` | string | no |  |
| `mins` | string | no | "x y z" local; add |
| `maxs` | string | no | "x y z" local; add |
| `priority` | integer | no |  |
| `falloffStart` | string | no | metres |
| `kind` | string | no | shore\|flow |
| `preview` | boolean | no |  |
| `directory` | string | no | new project folder |
| `label` | string | no |  |
| `backupId` | string | no |  |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_terrain_edit.<action>`. A row that links several actions is counted under each (25 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `backup` | 2 | T3 2 | `mcp:action/wb_terrain_edit.backup`, `mcp:handler-action/EMCP_WB_TerrainEdit.backup` |
| `brush` | 2 | T3 2 | `mcp:action/wb_terrain_edit.brush`, `mcp:handler-action/EMCP_WB_TerrainEdit.brush` |
| `exportMasks` | 4 | T3 4 | `api:WorldEditorAPI.ExportSurfaceMasks/2`, `mcp:action/wb_terrain_edit.exportMasks`, `mcp:handler-action/EMCP_WB_TerrainEdit.exportMasks` |
| `flatter` | 4 | T3 4 | `api:WorldEditorAPI.AddTerrainFlatterEntity/9`, `api:WorldEditorAPI.RemoveTerrainFlatterEntity/2`, `mcp:action/wb_terrain_edit.flatter` |
| `maps` | 4 | T3 4 | `api:WorldEditorAPI.BuildShoreMap/0`, `api:WorldEditorAPI.RegenerateFlowMaps/4`, `mcp:action/wb_terrain_edit.maps` |
| `restore` | 2 | T3 2 | `mcp:action/wb_terrain_edit.restore`, `mcp:handler-action/EMCP_WB_TerrainEdit.restore` |
| `tileRead` | 2 | T5 2 | `mcp:action/wb_terrain_edit.tileRead`, `mcp:handler-action/EMCP_WB_TerrainEdit.tileRead` |
| `tileWrite` | 5 | T3 5 | `api:WorldEditorAPI.BeginTerrainAction/2`, `api:WorldEditorAPI.EndTerrainAction/1`, `api:WorldEditorAPI.SetTerrainSurfaceTile/4` |
