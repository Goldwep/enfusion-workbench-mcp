# scenario_inspect

```text
Read-only inspector for an Enfusion scenario .conf file. Parses the mission header and reports the game mode class, linked world, factions, base/spawn-point count, objective count, and any sibling *_Layers/*.layer files. Pure filesystem operation — no project-index DB required. Complement to `scenario_create_conflict` (which writes scenarios).
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/scenario_inspect.md](../../../data/kb/census/tools/scenario_inspect.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `scenario_path` | string | yes | Path to the scenario .conf file. Absolute path, or repo-relative path resolved against the configured project path (e.g., 'Missions/MyConflict_Everon.conf'). |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/scenario_inspect.<action>`. A row that links several actions is counted under each (3 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 3 | T2 3 | `file:.conf`, `file:.ent`, `file:.layer` |
