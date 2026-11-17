# terrain_inspect

```text
Terrain bounds of the world open in the World Editor; world_path must name that world (refused otherwise). Requires Workbench running with the EMCP_WB_Terrain.c handler. Tiles, resolution and land area: wb_terrain info.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/terrain_inspect.md](../../../data/kb/census/tools/terrain_inspect.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `world_path` | string | yes | Path to the world `.ent` to inspect (e.g. 'worlds/MP/MyMap.ent') |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/terrain_inspect.<action>`. A row that links several actions is counted under each (2 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 2 | T3 2 | `mcp:action/terrain_inspect.run`, `mcp:handler-action/EMCP_WB_Terrain.inspect` |
