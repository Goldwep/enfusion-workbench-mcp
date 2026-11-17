# wb_entity_duplicate

```text
Save a placed entity (base-game instances too) as a new .et in your addon with a new GUID, register it, and by default replace the original in the scene, making it editable.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/wb_entity_duplicate.md](../../../data/kb/census/tools/wb_entity_duplicate.md) |

## Input parameters (4)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `entityName` | string | yes | entity placed in the scene |
| `destPath` | string | yes | addon-relative .et path |
| `modName` | string | no | addon folder; default the first found |
| `replaceInScene` | boolean | no | false: only write the prefab file Default: `true`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_entity_duplicate.<action>`. A row that links several actions is counted under each (6 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 6 | T2 4, T5 2 | `mcp:handler-action/EMCP_WB_CreateEntity.run`, `mcp:handler-action/EMCP_WB_DeleteEntity.run`, `mcp:handler-action/EMCP_WB_ModifyEntity.getProperty` |
