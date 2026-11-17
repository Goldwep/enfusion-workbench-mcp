# wb_entity_create

```text
1.x alias of wb_entity create. layerID is refused: use layer there.
```

| Field | Value |
| --- | --- |
| Tier | alias |
| Registered under ENFUSION_TOOLSET | all |
| Census KB page | [data/kb/census/tools/wb_entity_create.md](../../../data/kb/census/tools/wb_entity_create.md) |

## Input parameters (5)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `prefab` | string | yes |  |
| `position` | string | no | 'x y z' |
| `rotation` | string | no | 'pitch yaw roll' |
| `name` | string | no |  |
| `layerID` | integer | no |  |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_entity_create.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `mcp:handler-action/EMCP_WB_CreateEntity.run` |
