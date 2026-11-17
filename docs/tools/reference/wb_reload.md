# wb_reload

```text
Alias of wb_scripts reload: ReloadScripts, then a re-ping.
Mutating: reloads the scripts; refused while a mutating call is pending; a failed reload keeps the old handlers.
```

| Field | Value |
| --- | --- |
| Tier | alias |
| Registered under ENFUSION_TOOLSET | all |
| Census KB page | [data/kb/census/tools/wb_reload.md](../../../data/kb/census/tools/wb_reload.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `target` | string | no | Only 'scripts' is supported One of: `scripts`, `plugins`, `both`. Default: `"scripts"`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_reload.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `mcp:handler-action/EMCP_WB_Reload.run` |
