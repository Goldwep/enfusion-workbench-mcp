# wb_execute_action

```text
Alias of wb_menu run on the World Editor: runs a menu action by its comma-separated path (e.g., 'Window,Hierarchy'). Segments must be the exact menu labels and must come from a verified source; only allow-listed paths run, and a mutating item is a dry run unless confirm: true. Destructive actions (File,Close; File,New; File,Exit) are blocked.
```

| Field | Value |
| --- | --- |
| Tier | alias |
| Registered under ENFUSION_TOOLSET | all |
| Census KB page | [data/kb/census/tools/wb_execute_action.md](../../../data/kb/census/tools/wb_execute_action.md) |

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `menuPath` | string | yes | Comma-separated menu path of exact menu labels from a verified source (e.g., 'Window,Hierarchy') |
| `confirm` | boolean | no | true runs a mutating item; else a dry run |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_execute_action.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `mcp:handler-action/EMCP_WB_ExecuteAction.run` |
