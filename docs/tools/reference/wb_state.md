# wb_state

```text
Get a full snapshot of the current Workbench state. Returns mode (edit/play), entity count, selected entity count and names, terrain bounds, sub-scene, and prefab edit status.
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Census KB page | [data/kb/census/tools/wb_state.md](../../../data/kb/census/tools/wb_state.md) |

## Input parameters (0)

The tool takes no input parameters.

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_state.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `mcp:handler-action/EMCP_WB_GetState.run` |
