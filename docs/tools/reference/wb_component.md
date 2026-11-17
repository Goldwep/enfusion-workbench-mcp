# wb_component

```text
Add, remove or list an entity's components in the World Editor (add/remove in edit mode).
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/wb_component.md](../../../data/kb/census/tools/wb_component.md) |

## Actions (3)

`add`, `remove`, `list`

## Input parameters (4)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `entityName` | string | yes |  |
| `action` | string | yes | One of: `add`, `remove`, `list`. |
| `componentClass` | string | no | required for add/remove |
| `componentIndex` | number | no | which one to remove when the class repeats |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_component.<action>`. A row that links several actions is counted under each (6 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `add` | 2 | T2 1, T3 1 | `mcp:action/wb_component.add`, `mcp:handler-action/EMCP_WB_Components.add` |
| `list` | 2 | T2 1, T3 1 | `mcp:action/wb_component.list`, `mcp:handler-action/EMCP_WB_Components.list` |
| `remove` | 2 | T2 1, T3 1 | `mcp:action/wb_component.remove`, `mcp:handler-action/EMCP_WB_Components.remove` |
