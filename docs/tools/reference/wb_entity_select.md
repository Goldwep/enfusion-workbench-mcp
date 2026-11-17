# wb_entity_select

```text
1.x alias of wb_view select and selection.
```

| Field | Value |
| --- | --- |
| Tier | alias |
| Registered under ENFUSION_TOOLSET | all |
| Census KB page | [data/kb/census/tools/wb_entity_select.md](../../../data/kb/census/tools/wb_entity_select.md) |

## Actions (4)

`select`, `deselect`, `clear`, `getSelected`

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `select`, `deselect`, `clear`, `getSelected`. |
| `name` | string | no |  |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_entity_select.<action>`. A row that links several actions is counted under each (8 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `clear` | 2 | T2 1, T3 1 | `mcp:action/wb_entity_select.clear`, `mcp:handler-action/EMCP_WB_SelectEntity.clear` |
| `deselect` | 2 | T2 1, T3 1 | `mcp:action/wb_entity_select.deselect`, `mcp:handler-action/EMCP_WB_SelectEntity.deselect` |
| `getSelected` | 2 | T2 1, T3 1 | `mcp:action/wb_entity_select.getSelected`, `mcp:handler-action/EMCP_WB_SelectEntity.getSelected` |
| `select` | 2 | T2 1, T3 1 | `mcp:action/wb_entity_select.select`, `mcp:handler-action/EMCP_WB_SelectEntity.select` |
