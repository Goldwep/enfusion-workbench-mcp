# wb_play

```text
Switch Workbench to game (play) mode. Compiles scripts and launches the world for testing. Equivalent to pressing Play in the World Editor. Requires edit mode.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/wb_play.md](../../../data/kb/census/tools/wb_play.md) |

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `debugMode` | boolean | no | Enable debug mode (script breakpoints, extra logging) |
| `fullScreen` | boolean | no | Launch in full-screen mode instead of windowed |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_play.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `mcp:handler-action/EMCP_WB_EditorControl.play` |
