# faction_list_units

```text
Walk a project root, parse every .et / .conf entity, and group those that declare a faction affiliation by faction key. Emits a markdown table per faction with file, root class, and best-effort display name. Use this to audit which entities belong to which faction, or to find orphans after renaming a faction key. Note: the walker reads the literal `"faction affiliation"` property on `SCR_FactionAffiliationComponent` — it does NOT resolve affiliations inherited from a parent prefab (those would require an inheritance walk, not supported here).
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/faction_list_units.md](../../../data/kb/census/tools/faction_list_units.md) |

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `project_path` | string | no | Project root to scan. Defaults to the configured projectPath. Must not start with '-' (flag-smuggle guard). |
| `faction_key` | string | no | Filter to a single faction key (e.g. 'US'). When omitted, every faction key found is reported. Comparison is case-sensitive, matching the engine's behavior. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/faction_list_units.<action>`. A row that links several actions is counted under each (2 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 2 | T2 2 | `file:.conf`, `file:.et` |
