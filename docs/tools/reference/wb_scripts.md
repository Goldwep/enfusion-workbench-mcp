# wb_scripts

```text
Script compile train through Workbench's natives.
Read: status (running, ScriptsCompiled, worldEditorRunning, build stamp match); validate (ValidateScripts, configuration WORKBENCH|PC: errors, warnings, success).
Mutating: reload (ReloadScripts, then a re-ping; refused while a mutating call is pending; a failed reload keeps the old handlers).
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Census KB page | [data/kb/census/tools/wb_scripts.md](../../../data/kb/census/tools/wb_scripts.md) |

## Actions (3)

`status`, `validate`, `reload`

## Input parameters (3)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `status`, `validate`, `reload`. |
| `configuration` | string | no | validate: WORKBENCH (default) or PC One of: `WORKBENCH`, `PC`. |
| `scope` | string | no | reload: only 'scripts' |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_scripts.<action>`. A row that links several actions is counted under each (14 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `reload` | 4 | T2 3, T3 1 | `mcp:action/wb_scripts.reload`, `mcp:handler-action/EMCP_WB_Ping.run`, `net:native/IsWorkbenchRunning` |
| `status` | 4 | T2 2, T3 2 | `mcp:action/wb_scripts.status`, `mcp:handler-action/EMCP_WB_Ping.run`, `net:native/IsWorkbenchRunning` |
| `validate` | 6 | T2 3, T3 3 | `mcp:action/wb_scripts.validate`, `mcp:handler-action/EMCP_WB_Ping.run`, `net:native/IsWorkbenchRunning` |
