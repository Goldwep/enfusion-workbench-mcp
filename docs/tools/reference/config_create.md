# config_create

```text
Create a config (.conf) file for an Arma Reforger mod. Generates faction definitions, mission headers, entity catalogs, and editor placeables in valid Enfusion text format.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/config_create.md](../../../data/kb/census/tools/config_create.md) |

## Input parameters (16)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `configType` | string | yes | Config type. 'mission-header' for scenarios. 'faction' for faction definitions. 'entity-catalog' for categorized prefab lists. 'editor-placeables' for Game Master content. One of: `mission-header`, `faction`, `entity-catalog`, `editor-placeables`. |
| `name` | string | yes | Config name (used for filename, e.g., 'MyFaction') |
| `factionKey` | string | no | Faction identifier key (faction type). Auto-derived from name if omitted. |
| `factionColor` | string | no | Faction color 'R,G,B' or 'R,G,B,A', 0-255 each, e.g. '255,0,0,255' (faction type) |
| `flagPath` | string | no | Resource path to faction flag texture (faction type) |
| `worldPath` | string | no | Path to .ent world file (mission-header type). For Conflict mode use the full resource ref e.g. '{9DF143A76F5C6460}worlds/MP/CTI_Campaign_Eden.ent'. |
| `scenarioName` | string | no | Display name for the scenario (mission-header type) |
| `scenarioDescription` | string | no | Scenario description (mission-header type) |
| `missionMode` | string | no | Mission header mode (mission-header type only). 'Conflict' (default) generates SCR_MissionHeaderCampaign for multiplayer Conflict/Campaign scenarios. 'SF' generates SCR_MissionHeader for Scenario Framework single-player/co-op narrative missions. One of: `Conflict`, `SF`. |
| `author` | string | no | Scenario author name (mission-header Conflict mode) |
| `gameModeLabel` | string | no | Game mode display name, e.g. 'Conflict', 'Seize & Secure' (mission-header Conflict mode, default 'Conflict') |
| `playerCount` | number | no | Max player count (mission-header Conflict mode, default 40) |
| `xpMultiplier` | number | no | XP multiplier, e.g. 0.5 for PvE (mission-header Conflict mode, omitted if 1.0) |
| `prefabRefs` | array<string> | no | Prefab resource paths (entity-catalog, editor-placeables types) |
| `categoryName` | string | no | Ignored: vanilla catalogs and placeables registries hold no category name |
| `projectPath` | string | no | Addon root path. Uses configured default if omitted. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/config_create.<action>`. A row that links several actions is counted under each (2 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 2 | T2 2 | `file:.conf`, `mcp:action/config_create.run` |
