# wb_stop

```text
Stop game mode and return to the World Editor. Equivalent to pressing Stop in the World Editor. Requires play mode.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/wb_stop.md](../../../data/kb/census/tools/wb_stop.md) |

## Input parameters (0)

The tool takes no input parameters.

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_stop.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `mcp:handler-action/EMCP_WB_EditorControl.stop` |
