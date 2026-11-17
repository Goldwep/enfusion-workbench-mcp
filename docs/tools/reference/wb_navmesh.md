# wb_navmesh

```text
Navmesh of the open world via its AIWorld: tile state, tile load, reachable point, in-memory rebuilds.
Read:
status: AIWorld, navmesh projects, paged tile grid
tile: Tile state at one position
reachable: Nearest reachable navmesh point
Mutating:
load: Load the tile at a position (memory)
rebuild: Rebuild a box in memory (confirm)
rebuildEntity: Rebuild around an entity in memory (confirm)
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Handler contract | `contracts/EMCP_WB_Navmesh.json` (EMCP_WB_Navmesh) |
| Census KB page | [data/kb/census/tools/wb_navmesh.md](../../../data/kb/census/tools/wb_navmesh.md) |

## Actions (6)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `status` | no | no | AIWorld, navmesh projects, paged tile grid Refuses: NO_WORLD; WRONG_MODE in prefab edit or play mode; NO_AI_WORLD; NO_NAVMESH_COMPONENT for a project the AIWorld does not declare; STALE_CURSOR | `project` (string), `step` (string), `cursor` (string), `limit` (int) |
| `tile` | no | no | Tile state at one position Refuses: as status | `position`* (string), `project` (string) |
| `load` | yes | no | Load the tile at a position (memory) Refuses: as status | `position`* (string), `project` (string) |
| `reachable` | no | no | Nearest reachable navmesh point Refuses: as status; the point waits on P-W5-14 (the vector has no out marker), found is answered either way | `position`* (string), `distance`* (string), `project` (string) |
| `rebuild` | yes | yes | Rebuild a box in memory (confirm) Refuses: NOT_IN_PROJECT unless the open world is the project's; BOX_TOO_LARGE above 512 m per side; NO_AI_WORLD; nothing is saved | `min`* (string), `max`* (string), `confirm` (bool) |
| `rebuildEntity` | yes | yes | Rebuild around an entity in memory (confirm) Refuses: NOT_IN_PROJECT; ENTITY_NOT_FOUND; NOT_SCR_AI_WORLD when the AIWorld is not SCR_AIWorld; BOX_TOO_LARGE for an area above 512 m per side | `entity`* (string), `confirm` (bool) |

`*` marks a required parameter of that action.

## Input parameters (11)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `status`, `tile`, `load`, `reachable`, `rebuild`, `rebuildEntity`. |
| `project` | string | no | declared navmesh project; default first |
| `step` | string \| number | no | m as text; default 24, grid <= 40000 |
| `cursor` | string | no | opaque; from nextCursor |
| `limit` | integer | no | default 100, max 200 |
| `position` | string | no | x y z as text, inside the terrain |
| `distance` | string \| number | no | m as text, above 0, at most 500 |
| `min` | string | no | x y z as text |
| `max` | string | no | x y z as text; side <= 512 m |
| `confirm` | boolean | no | false: dry run |
| `entity` | string | no | id:/name:/index: ref |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_navmesh.<action>`. A row that links several actions is counted under each (12 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `load` | 2 | T5 2 | `mcp:action/wb_navmesh.load`, `mcp:handler-action/EMCP_WB_Navmesh.load` |
| `reachable` | 2 | T5 2 | `mcp:action/wb_navmesh.reachable`, `mcp:handler-action/EMCP_WB_Navmesh.reachable` |
| `rebuild` | 2 | T3 2 | `mcp:action/wb_navmesh.rebuild`, `mcp:handler-action/EMCP_WB_Navmesh.rebuild` |
| `rebuildEntity` | 2 | T3 2 | `mcp:action/wb_navmesh.rebuildEntity`, `mcp:handler-action/EMCP_WB_Navmesh.rebuildEntity` |
| `status` | 2 | T5 2 | `mcp:action/wb_navmesh.status`, `mcp:handler-action/EMCP_WB_Navmesh.status` |
| `tile` | 2 | T5 2 | `mcp:action/wb_navmesh.tile`, `mcp:handler-action/EMCP_WB_Navmesh.tile` |
