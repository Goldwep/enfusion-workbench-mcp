# scenario_create

```text
Create a scenario element in the live Workbench scene. Use type='objective' for Scenario Framework objectives (SP/co-op narrative missions): places an Area → LayerTask → Layer_AI → SlotKill + SlotAI hierarchy. Use type='base' for Conflict multiplayer bases: places a ConflictBase entity, ambient patrol spawnpoints, and a faction spawn point. Requires Workbench running in Edit mode with a world open.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/scenario_create.md](../../../data/kb/census/tools/scenario_create.md) |

## Input parameters (13)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | string | yes | Action discriminator. 'objective' = Scenario Framework objective (SP/co-op). 'base' = Conflict military base (MP). One of: `base`, `objective`. |
| `position` | string | no | World position as 'x y z' (e.g. '1234 0 5678'). Omit to place at the current camera position. |
| `taskType` | string | no | (objective) Objective type. Determines which LayerTask and Slot prefabs are used. One of: `kill`, `clearArea`, `destroy`. |
| `taskName` | string | no | (objective) Short identifier used as entity name prefix and task title (e.g. 'Eliminate_Patrol'). No spaces — use underscores. All placed entity names derive from this. |
| `description` | string | no | (objective) Task description shown to the player in the task list. |
| `targetPrefab` | string | no | (objective) Prefab path for the entity the player must kill/destroy/clear. For 'kill' type this must be a CHARACTER prefab. For 'destroy' type this is a vehicle or object prefab. For 'clearArea' type this is the object prefab to clear. Use asset_search to find the GUID-prefixed path. WARNING: do NOT pass a group prefab here — that causes a NULL pointer crash at runtime. |
| `aiGroupPrefab` | string | no | (objective) Prefab path for the AI group to spawn via SlotAI (e.g. '{GUID}Prefabs/Groups/OPFOR/Group_USSR_LightFireTeam.et'). This must be a GROUP prefab, not a character prefab. Use asset_search to find the GUID-prefixed path. |
| `triggerRadius` | number | no | (objective) Radius in metres of the Area trigger that activates the objective. Default 100. Default: `100`. |
| `faction` | string | no | (objective) Faction key that owns this task (e.g. 'US', 'USSR'). Optional. |
| `baseName` | string | no | (base) Base name/callsign, e.g. 'BaseAlpha'. Used as entity name prefix and m_sBaseName property. |
| `baseFaction` | string | no | (base) Faction that starts as owner: 'US', 'USSR', 'FIA', or a custom faction key. |
| `baseType` | string | no | (base) Base type. 'base' (default) = standard contested base. 'MOB' = main operating base / HQ (seizing disabled, 3000 supplies, radio source). One of: `base`, `MOB`. |
| `patrolCount` | number | no | (base) Number of ambient patrol spawnpoints to place around the base (0-6, default 2). Default: `2`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/scenario_create.<action>`. A row that links several actions is counted under each (5 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 5 | T2 5 | `mcp:handler-action/EMCP_WB_CreateEntity.run`, `mcp:handler-action/EMCP_WB_DeleteEntity.run`, `mcp:handler-action/EMCP_WB_GetCameraPos.run` |
