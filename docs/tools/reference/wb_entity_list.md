# wb_entity_list

```text
1.x alias of wb_entity list. Only offset 0: page with its cursor.
```

| Field | Value |
| --- | --- |
| Tier | alias |
| Registered under ENFUSION_TOOLSET | all |
| Census KB page | [data/kb/census/tools/wb_entity_list.md](../../../data/kb/census/tools/wb_entity_list.md) |

## Input parameters (3)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `offset` | number | no | Default: `0`. |
| `limit` | number | no | Default: `50`. |
| `nameFilter` | string | no |  |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_entity_list.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T1 1 | `mcp:handler-action/EMCP_WB_ListEntities.run` |
