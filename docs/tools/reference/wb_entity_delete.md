# wb_entity_delete

```text
1.x alias of wb_entity delete, by name.
```

| Field | Value |
| --- | --- |
| Tier | alias |
| Registered under ENFUSION_TOOLSET | all |
| Census KB page | [data/kb/census/tools/wb_entity_delete.md](../../../data/kb/census/tools/wb_entity_delete.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes |  |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_entity_delete.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `mcp:handler-action/EMCP_WB_DeleteEntity.run` |
