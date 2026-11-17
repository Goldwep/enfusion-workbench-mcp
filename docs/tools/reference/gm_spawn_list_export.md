# gm_spawn_list_export

```text
Walk a project's `SCR_PlaceableEntitiesRegistry` configs — the Game Master spawn-menu catalog — and group spawnable prefabs by faction/category. Returns one markdown table per faction by default, or JSON when `format='json'`. Faction keys are inferred from the registry filename stem (e.g., `Characters_BLUFOR.conf` -> `BLUFOR`); category is the parent directory name under `Configs/Editor/PlaceableEntities/`. Read-only — no files are modified.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/gm_spawn_list_export.md](../../../data/kb/census/tools/gm_spawn_list_export.md) |

## Input parameters (3)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `project_path` | string | no | Absolute path (or one resolved against CWD) to the project root to scan. Defaults to the configured `projectPath` (ENFUSION_PROJECT_PATH). |
| `faction_filter` | string | no | Narrow the output to a single faction key (e.g., 'BLUFOR', 'US', 'Forest'). Match is exact — omit the filter for a list of every group. |
| `format` | string | no | Output format. 'markdown' (default) yields one table per faction; 'json' yields `{factions: [{key, name, entries: [{category, display, prefab}]}]}` wrapped in a fenced code block. One of: `markdown`, `json`. Default: `"markdown"`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/gm_spawn_list_export.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.conf` |
