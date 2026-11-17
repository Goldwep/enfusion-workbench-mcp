# wb_save

```text
Alias of wb_module save on the World Editor. Without confirm: true this is a dry run that names the world and writes nothing; confirm: true saves. Save As is not supported: passing `path` is refused with INVALID_ARGUMENT.
```

| Field | Value |
| --- | --- |
| Tier | alias |
| Registered under ENFUSION_TOOLSET | all |
| Census KB page | [data/kb/census/tools/wb_save.md](../../../data/kb/census/tools/wb_save.md) |

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | no | Save As path (1.x name): refused, Save As is not supported. |
| `confirm` | boolean | no | true writes the world; otherwise a dry run |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_save.<action>`. A row that links several actions is counted under each (2 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 2 | T2 2 | `mcp:handler-action/EMCP_WB_EditorControl.save`, `mcp:handler-action/EMCP_WB_EditorControl.saveAs` |
