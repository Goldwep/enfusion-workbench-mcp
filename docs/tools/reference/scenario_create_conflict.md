# scenario_create_conflict

```text
Generate a Conflict scenario (up to 7 files): mission header .conf, SubScene .ent, and layers default (game mode, managers), Bases, CAH (major-base capture zones), Defenders, and AmbientVehicles (when civVehicleCount > 0). Known worlds: everon, arland, western everon. Open the .ent in Workbench afterwards to snap entities to terrain.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/scenario_create_conflict.md](../../../data/kb/census/tools/scenario_create_conflict.md) |

## Input parameters (12)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `scenarioName` | string | yes | file name, no spaces; display name by default |
| `scenarioDisplayName` | string | no |  |
| `worldName` | string | yes | a known world or a {GUID}worlds/X.ent ref |
| `bases` | array<object> | yes | bases to place: at least one MOB per faction and 2+ contested bases |
| `playerCount` | number | no | Max player count (default 40). |
| `xpMultiplier` | number | no | default 1.0; 0.5 suits PvE |
| `savingEnabled` | boolean | no | Enable Conflict persistence/saving (default true). |
| `gameModeLabel` | string | no | Game mode display label shown in the server browser (default 'Conflict'). |
| `description` | string | no | Scenario description shown in the mission browser. |
| `author` | string | no | Author name shown in the mission browser. |
| `civVehicleCount` | number | no | civilian vehicle spawnpoints, default 0 |
| `projectPath` | string | no | Addon root path. Uses configured default if omitted. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/scenario_create_conflict.<action>`. A row that links several actions is counted under each (4 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 4 | T2 4 | `file:.conf`, `file:.ent`, `file:.layer` |
