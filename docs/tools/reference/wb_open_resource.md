# wb_open_resource

```text
Alias of wb_module setResource: opens a project-relative resource in the module that owns its file type (a .ent or .et in the World Editor, a .conf, .emat or .layout in the Resource Manager). An absolute path is refused with ABSOLUTE_PATH.
```

| Field | Value |
| --- | --- |
| Tier | alias |
| Registered under ENFUSION_TOOLSET | all |
| Census KB page | [data/kb/census/tools/wb_open_resource.md](../../../data/kb/census/tools/wb_open_resource.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | string | yes | Project-relative resource path (e.g., 'Worlds/Test.ent'); absolute paths are refused |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_open_resource.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `mcp:handler-action/EMCP_WB_EditorControl.openResource` |
