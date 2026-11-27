# wb_validate_scripts

```text
Alias of wb_scripts validate: ValidateScripts through the running Workbench.
Read: compile errors, warnings, success for configuration PC or WORKBENCH. Needs Workbench running; no project edits.
```

| Field | Value |
| --- | --- |
| Tier | alias |
| Registered under ENFUSION_TOOLSET | all |
| Census KB page | [data/kb/census/tools/wb_validate_scripts.md](../../../data/kb/census/tools/wb_validate_scripts.md) |

## Input parameters (4)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `config` | string | no | Script configuration to compile One of: `PC`, `WORKBENCH`. Default: `"WORKBENCH"`. |
| `gproj_path` | string | no | 1.x key, refused when given: validates the open project |
| `timeout_seconds` | number | no | 1.x key, refused when given |
| `launcher_nudge` | boolean | no | 1.x key, refused when given |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_validate_scripts.<action>`. A row that links several actions is counted under each (3 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 3 | T2 3 | `mcp:handler-action/EMCP_WB_Ping.run`, `net:native/IsWorkbenchRunning`, `net:native/ValidateScripts` |
