# scenario_diff

```text
Compute a high-level structural diff between two scenario .conf files. Reports per-section deltas (game-mode class, linked world, factions, base/spawn count, objective count, layer set) plus a list of scalar properties whose values differ. Differs from `world_diff` (per-entity): this is per-section summary, useful for spotting what changed between a Beta-Branch version of a scenario and its main-branch counterpart before merging. Pure filesystem read — no project-index dependency.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/scenario_diff.md](../../../data/kb/census/tools/scenario_diff.md) |

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `before_path` | string | yes | Absolute path to the BEFORE scenario .conf (e.g., main-branch version). |
| `after_path` | string | yes | Absolute path to the AFTER scenario .conf (e.g., Beta-Branch version). |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/scenario_diff.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.conf` |
