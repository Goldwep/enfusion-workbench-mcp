# wb_undo_redo

```text
Undo or redo the last action in the World Editor.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/wb_undo_redo.md](../../../data/kb/census/tools/wb_undo_redo.md) |

## Actions (2)

`undo`, `redo`

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | Whether to undo or redo One of: `undo`, `redo`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_undo_redo.<action>`. A row that links several actions is counted under each (4 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `redo` | 2 | T0 1, T2 1 | `mcp:action/wb_undo_redo.redo`, `mcp:handler-action/EMCP_WB_EditorControl.redo` |
| `undo` | 2 | T0 1, T2 1 | `mcp:action/wb_undo_redo.undo`, `mcp:handler-action/EMCP_WB_EditorControl.undo` |
