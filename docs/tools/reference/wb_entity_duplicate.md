# wb_entity_duplicate

```text
Save a placed entity, its instance overrides included, as a new .et in the open project (Workbench createTemplate: any prefab source; whether the result inherits from the ancestor or is flattened is unverified), then by default replace the original with an instance of it on the same layer under the same name. A child entity is refused.
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
| `destPath` | string | yes | new addon-relative .et; the open project's |
| `modName` | string | no | addon folder; default the first found |
| `replaceInScene` | boolean | no | false: write the prefab file and skip the replace; the placed entity may still become an instance of it Default: `true`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_entity_duplicate.<action>`. A row that links several actions is counted under each (6 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 6 | T2 4, T5 2 | `mcp:handler-action/EMCP_WB_CreateEntity.run`, `mcp:handler-action/EMCP_WB_DeleteEntity.run`, `mcp:handler-action/EMCP_WB_ModifyEntity.getProperty` |
