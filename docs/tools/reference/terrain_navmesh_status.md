# terrain_navmesh_status

```text
Alias of wb_navmesh status: navmesh tile coverage (loaded, valid, requested) of the world open in the World Editor, through its AIWorld. Open the world first; world_path is refused (no equivalent).
```

| Field | Value |
| --- | --- |
| Tier | alias |
| Registered under ENFUSION_TOOLSET | all |
| Census KB page | [data/kb/census/tools/terrain_navmesh_status.md](../../../data/kb/census/tools/terrain_navmesh_status.md) |

## Input parameters (5)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `world_path` | string | no | 1.x key, refused when given: wb_navmesh reads the open world. |
| `project` | string | no | Navmesh project (wb_navmesh status). |
| `step` | string | no | Grid step in metres (wb_navmesh status). |
| `cursor` | string | no | Cursor from the last page. |
| `limit` | integer | no | Grid points per page. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/terrain_navmesh_status.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `mcp:handler-action/EMCP_WB_Terrain.navmesh_status` |
