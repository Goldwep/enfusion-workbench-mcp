# wb_diagnose

```text
Diagnose the EnfusionMCP to Workbench connection when wb_launch fails or wb_connect errors.
Read: config, handler script locations, lease holder, no-autolaunch marker, native readiness (IsWorkbenchRunning, ScriptsCompiled, build-stamp match). Never launches Workbench or takes the lease.
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Handler contract | `contracts/EMCP_WB_Info.json` (EMCP_WB_Info) |
| Census KB page | [data/kb/census/tools/wb_diagnose.md](../../../data/kb/census/tools/wb_diagnose.md) |

## Actions (1)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `info` | no | no | Answer the bridge facts; opens nothing, writes nothing | none |

`*` marks a required parameter of that action.

## Input parameters (0)

The tool takes no input parameters.

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_diagnose.<action>`. A row that links several actions is counted under each (2 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 2 | T2 2 | `mcp:handler-action/EMCP_WB_Ping.run`, `net:native/IsWorkbenchRunning` |
