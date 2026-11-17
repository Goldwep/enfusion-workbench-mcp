# server_scenario_picker

```text
List available mission scenarios: the curated catalog of official Bohemia scenarios (Conflict, Game Master, Combat Ops, Tutorial), plus any `SCR_MissionHeader*` .conf files found under your project's Missions/ subdirectories. Set `include_workshop` to also scan the workshop addons directory. Returns a markdown table per source.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/server_scenario_picker.md](../../../data/kb/census/tools/server_scenario_picker.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `include_workshop` | boolean | no | When true, also scan the workshop addons directory for mission .conf files. Default false because workshop directories can be large. Default: `false`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/server_scenario_picker.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.conf` |
