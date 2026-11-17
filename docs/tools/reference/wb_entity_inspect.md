# wb_entity_inspect

```text
1.x alias of wb_entity get, by name or index.
```

| Field | Value |
| --- | --- |
| Tier | alias |
| Registered under ENFUSION_TOOLSET | all |
| Census KB page | [data/kb/census/tools/wb_entity_inspect.md](../../../data/kb/census/tools/wb_entity_inspect.md) |

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | no |  |
| `index` | number | no |  |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_entity_inspect.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T1 1 | `mcp:handler-action/EMCP_WB_GetEntity.run` |
