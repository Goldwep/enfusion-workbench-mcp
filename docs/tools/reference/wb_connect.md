# wb_connect

```text
Test the connection to Arma Reforger Workbench.
Read: native readiness (IsWorkbenchRunning, ScriptsCompiled), whether the shipped handlers answer Ping, build-stamp match, editor mode. Sends nothing that changes state.
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Census KB page | [data/kb/census/tools/wb_connect.md](../../../data/kb/census/tools/wb_connect.md) |

## Input parameters (0)

The tool takes no input parameters.

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_connect.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `mcp:handler-action/EMCP_WB_Ping.run` |
