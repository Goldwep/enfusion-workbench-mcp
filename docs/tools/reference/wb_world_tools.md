# wb_world_tools

```text
Dialog-free ports of vanilla World Editor plugins and tools.
Read:
exportObjects: entities as import rows
floaters: entities off the terrain
stats: counts per prefab, layer, grid
Mutating:
goToCoords: (TS) camera to link or coords
importObjects: create from import rows
snapToTerrain: snap and orient to terrain
resetFlags: flags back to the prefab's
replaceEntities: swap entities for prefabs
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Handler contract | `contracts/EMCP_WB_WorldTools.json` (EMCP_WB_WorldTools) |
| Census KB page | [data/kb/census/tools/wb_world_tools.md](../../../data/kb/census/tools/wb_world_tools.md) |

## Actions (8)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `exportObjects` | no | no | entities as import rows | `entities` (array<string>), `layer` (string), `cursor` (string), `limit` (int) |
| `floaters` | no | no | entities off the terrain | `entities` (array<string>), `radius` (float), `activeLayerOnly` (bool), `vegetation` (bool), `belowTerrain` (bool), `belowWater` (bool), `minOffset` (float), `maxOffset` (float), `limit` (int) |
| `stats` | no | no | counts per prefab, layer, grid | `activeLayerOnly` (bool), `gridSize` (int), `cursor` (string), `limit` (int) |
| `goToCoords` | yes | yes | (TS) camera to link or coords Refuses: Served by the TS tool: parses the text, reads terrain height through wb_terrain heights, then calls wb_view setCamera. No handler code. | `text`* (string) |
| `importObjects` | yes | yes | create from import rows | `path` (string), `rows` (array<string>), `layer` (string), `relativeY` (bool) |
| `snapToTerrain` | yes | yes | snap and orient to terrain | `entities` (array<string>) |
| `resetFlags` | yes | yes | flags back to the prefab's Refuses: No refs, no selection and no allWorld: true is INVALID_ARGUMENT; the whole world is never the silent default. | `entities` (array<string>), `allWorld` (bool), `flags` (array<string>), `categories` (array<string>), `includeChildren` (bool) |
| `replaceEntities` | yes | yes | swap entities for prefabs | `pairs`* (array<string>), `keepChildren` (bool) |

`*` marks a required parameter of that action.

## Input parameters (23)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `exportObjects`, `floaters`, `stats`, `goToCoords`, `importObjects`, `snapToTerrain`, `resetFlags`, `replaceEntities`. |
| `entities` | array<string> | no | refs; default selection |
| `layer` | string | no | layer path instead of refs |
| `cursor` | string | no | nextCursor of a page |
| `limit` | integer | no | rows per page, max 200 |
| `radius` | number | no | metres around camera if no refs |
| `activeLayerOnly` | boolean | no | default false |
| `vegetation` | boolean | no | include trees and bushes |
| `belowTerrain` | boolean | no | also report sunk entities |
| `belowWater` | boolean | no | also report entities under water |
| `minOffset` | number | no | metres; default 0.05 |
| `maxOffset` | number | no | metres; default 100 |
| `gridSize` | integer | no | cells per side, 0 = none, max 64 |
| `text` | string | no | enfusion link, x,y,z;p,y,r or grid |
| `path` | string | no | project CSV; TS reads it into rows |
| `rows` | array<string> | no | prefab;x y z;qx qy qz qw;scale |
| `relativeY` | boolean | no | y above terrain |
| `allWorld` | boolean | no | every editor entity |
| `flags` | array<string> | no | EntityFlags names; default 10 |
| `categories` | array<string> | no | rocks\|trees\|bushes\|buildings\|any |
| `includeChildren` | boolean | no | default false |
| `pairs` | array<string> | no | ref=prefab; max 200 |
| `keepChildren` | boolean | no | re-parent children; default true |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_world_tools.<action>`. A row that links several actions is counted under each (16 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `exportObjects` | 2 | T5 2 | `mcp:action/wb_world_tools.exportObjects`, `mcp:handler-action/EMCP_WB_WorldTools.exportObjects` |
| `floaters` | 2 | T5 2 | `mcp:action/wb_world_tools.floaters`, `mcp:handler-action/EMCP_WB_WorldTools.floaters` |
| `goToCoords` | 2 | T5 2 | `mcp:action/wb_world_tools.goToCoords`, `mcp:handler-action/EMCP_WB_WorldTools.goToCoords` |
| `importObjects` | 2 | T5 2 | `mcp:action/wb_world_tools.importObjects`, `mcp:handler-action/EMCP_WB_WorldTools.importObjects` |
| `replaceEntities` | 2 | T5 2 | `mcp:action/wb_world_tools.replaceEntities`, `mcp:handler-action/EMCP_WB_WorldTools.replaceEntities` |
| `resetFlags` | 2 | T3 2 | `mcp:action/wb_world_tools.resetFlags`, `mcp:handler-action/EMCP_WB_WorldTools.resetFlags` |
| `snapToTerrain` | 2 | T3 2 | `mcp:action/wb_world_tools.snapToTerrain`, `mcp:handler-action/EMCP_WB_WorldTools.snapToTerrain` |
| `stats` | 2 | T5 2 | `mcp:action/wb_world_tools.stats`, `mcp:handler-action/EMCP_WB_WorldTools.stats` |
