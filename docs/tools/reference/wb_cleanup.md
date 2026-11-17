# wb_cleanup

```text
Remove the temporary EnfusionMCP handler scripts from a mod's directory. Deletes Scripts/WorkbenchGame/EnfusionMCP/ from the mod. Call this after finishing Workbench work and before the user publishes their mod. Safe to call even if scripts were never installed.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/wb_cleanup.md](../../../data/kb/census/tools/wb_cleanup.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `modDir` | string | yes | Path to the mod's root directory (the folder containing the .gproj file). |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_cleanup.<action>`. A row that links several actions is counted under each (2 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 2 | T2 2 | `file:.c`, `file:.gproj` |
