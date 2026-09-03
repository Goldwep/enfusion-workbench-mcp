# Scenario + faction tools (L3 / L8)

Tools that author, inspect, and validate Arma Reforger scenarios and the factions they reference. Mix of pure-FS readers, scenario writers (with the L5 safety doctrine — dry-run defaults, `.bak` sidecars, git-clean refuse), and one live-Workbench placement tool (`scenario_create`).

## Scenario tools

### scenario_create

**Live Workbench.** Place a scenario element directly into the running editor's scene. Two flavors picked via `type`:

- `type: "objective"` — Scenario Framework objective (SP / co-op narrative missions). Places an `Area → LayerTask → Layer_AI → SlotKill + SlotAI` hierarchy.
- `type: "base"` — Conflict multiplayer base. Places a `ConflictBase` entity, ambient patrol spawnpoints, and a faction spawn point.

**Input (objective):**

```json
{
  "type": "objective",
  "taskType": "clearArea",
  "taskName": "Eliminate_Patrol",
  "position": "1234 0 5678"
}
```

**Input (base):**

```json
{
  "type": "base",
  "baseName": "Camp_Tango",
  "factionKey": "US",
  "position": "1234 0 5678"
}
```

**Requires:** Workbench running in Edit mode with a world open.

### scenario_create_conflict

**Pure FS write.** Generate a complete Conflict multiplayer scenario as up to 7 files: mission header `.conf`, SubScene world stub `.ent`, plus layer files (`default.layer` with game-mode + managers, `Bases.layer`, `CAH.layer`, `Defenders.layer`, optional `AmbientVehicles.layer` when `civVehicleCount > 0`). Mirrors the structure of production Workshop Conflict mods.

**Input:**

```json
{
  "scenarioName": "MyConflict_Everon",
  "worldName": "Everon",
  "bases": [
    { "name": "MOB_US", "factionKey": "US", "position": [1000, 0, 1000], "isMOB": true },
    { "name": "MOB_USSR", "factionKey": "USSR", "position": [5000, 0, 5000], "isMOB": true },
    { "name": "Camp_North", "factionKey": "NEUTRAL", "position": [3000, 0, 4000], "isContested": true }
  ],
  "playerCount": 40
}
```

**Generates:**

- `GameMode_Seize` entity in `default.layer`
- `CampaignFactionManager` with the faction roster
- Per-base: `SCR_CampaignSeizingComponent` + radio + patrol spawnpoints
- Capture zones for major bases in `CAH.layer`

**Known worlds:** `Everon`, `Arland`, `Western Everon`. Custom maps use `worldName: "{GUID}worlds/MyMap.ent"`.

**Post-write:** open the `.ent` in Workbench to snap entities to terrain.

### scenario_inspect

**Read-only.** Parse a scenario `.conf`, report the game-mode class, linked world, factions, base/spawn-point count, objective count, and any sibling `*_Layers/*.layer` files. No project-index dependency.

**Input:**

```json
{ "scenario_path": "Missions/MyConflict_Everon.conf" }
```

**Sample output:**

```
## Scenario: Missions/MyConflict_Everon.conf

- **Game mode class:** SCR_GameModeCampaign
- **Linked world:** {ECD73C3C5DD63ED9}worlds/Everon/Everon.ent
- **Factions:** US, USSR, FIA
- **Bases:** 7 (2 MOBs, 5 contested)
- **Spawn points:** 14
- **Objectives:** 0
- **Sibling layers:**
  - MyConflict_Everon_Layers/Bases.layer
  - MyConflict_Everon_Layers/CAH.layer
  - MyConflict_Everon_Layers/Defenders.layer
```

### scenario_diff

**Read-only.** High-level structural diff between two scenario `.conf` files. Reports per-section deltas (game-mode class, linked world, factions, base/spawn count, objective count, layer set) plus scalar properties whose values differ. Pairs with the Beta-Branch → main workflow: diff the Beta version against main before merging.

**Input:**

```json
{
  "before_path": "Missions/MyConflict_Everon.conf",
  "after_path": "../Beta-Branch/Missions/MyConflict_Everon.conf"
}
```

**Sample output:**

```
## scenario_diff

before: MyConflict_Everon.conf (main)
after:  MyConflict_Everon.conf (Beta-Branch)

Section deltas:
  - Bases:     7 → 9     (+2)
  - Spawn pts: 14 → 18   (+4)
  - Objectives: 0 → 0    (no change)

Scalar properties changed:
  - m_iMaxPlayers: 40 → 64
  - m_fXPMultiplier: 1.0 → 1.5
```

Differs from `world_diff` (which does per-entity diff inside a world). This is per-section summary.

### scenario_clone_area

**FS write with L5 safety.** Clone a rectangular world-coord area of a scenario layer (`.conf` / `.et` / `.layer`) into a new file, regenerating every embedded GUID so the clone doesn't collide with the source. Optional X/Z translate. `.bak` sidecar; git-clean refuse; `force: true` override.

**Input:**

```json
{
  "source_layer_path": "C:/.../Missions/MyConflict_Everon_Layers/Bases.layer",
  "dest_layer_path":   "C:/.../Missions/MyConflict_Everon_Layers/Bases_Cloned.layer",
  "area":      { "minX": 1000, "minZ": 1000, "maxX": 2000, "maxZ": 2000 },
  "translate": { "x": 5000, "z": 5000 },
  "dry_run":   true
}
```

**Note:** writes by default — pass `dry_run: true` first to preview the count, sample GUID swaps, and translate vector. Refuses if `dest_layer_path` exists unless `force: true`.

### scenario_apply_template

**FS write with L5 safety.** Stamp a curated template (`fob_basic` / `checkpoint` / `patrol_grid`) into an existing scenario layer at a world position. Appends the template's entities as new top-level entries; existing entities are left untouched. Placeholder resource refs use sentinel GUIDs that agents are expected to replace via `refactor_replace_guid`.

**Input:**

```json
{
  "target_layer_path": "C:/.../Missions/MyConflict_Everon_Layers/Bases.layer",
  "template_name":     "fob_basic",
  "position":          { "x": 3000, "y": 0, "z": 4000 },
  "rotation_yaw_deg":  90,
  "dry_run":           true
}
```

Defaults to `dry_run: true` — stamping mutates layer files, so the safe default is preview-first.

### gm_spawn_list_export

**Read-only.** Walk a project's `SCR_PlaceableEntitiesRegistry` configs — the Game Master spawn-menu catalog — and group spawnable prefabs by faction / category. One markdown table per faction (default), or JSON via `format: "json"`. Faction keys are inferred from the registry filename stem (e.g. `Characters_BLUFOR.conf` → `BLUFOR`); category is the parent directory name under `Configs/Editor/PlaceableEntities/`.

**Input:**

```json
{ "project_path": "C:/.../addons/MyMod", "faction_filter": "BLUFOR", "format": "markdown" }
```

**Sample output:**

```
## GM Spawn List: MyMod

### BLUFOR

| Category    | Display          | Prefab                                    |
|-------------|------------------|-------------------------------------------|
| Characters  | US Rifleman      | {GUID}Prefabs/Char/US/Rifleman.et         |
| Characters  | US Medic         | {GUID}Prefabs/Char/US/Medic.et            |
| Vehicles    | UAZ-469          | {GUID}Prefabs/Vehicles/UAZ_469.et         |
```

## Faction tools

### faction_create

**FS write with L5 safety.** Scaffold a new `Configs/Factions/<Key>.conf` for an Arma Reforger mod. Emits `SCR_Faction` with `m_sFactionKey`, `m_sFactionName`, and a nested `m_FactionColor` (R/G/B/A) block. Refuses on existing file or uncommitted git changes; `force: true` overrides. `dry_run: true` previews.

**Validates:** `faction_key` must match `^[A-Z][A-Z0-9_]{1,15}$` (uppercase leading letter, 2-16 chars, uppercase + digits + underscore only).

**Input:**

```json
{
  "faction_key": "FIA",
  "display_name": "Forces of Independent Armament",
  "color_rgb": { "r": 80, "g": 110, "b": 60 },
  "out_path": "C:/.../addons/MyMod/Configs/Factions/FIA.conf",
  "dry_run": false
}
```

**For the legacy `m_sKey` / `m_sName` / `m_Color`-string shape**, use `config_create` with `configType: 'faction'` instead. `faction_create` emits the modern `SCR_Faction` shape used by current Reforger code.

### faction_list_units

**Read-only.** Walk a project root, parse every `.et` / `.conf` entity, and group those that declare a faction affiliation by faction key. Markdown table per faction with file, root class, and best-effort display name.

**Input:**

```json
{ "project_path": "C:/.../addons/MyMod", "faction_key": "US" }
```

**Sample output:**

```
## faction_list_units: MyMod (filter=US)

### US

| File                                          | Root class               | Display name        |
|-----------------------------------------------|--------------------------|---------------------|
| Prefabs/Characters/US/Rifleman.et             | SCR_ChimeraCharacter     | US Rifleman         |
| Prefabs/Characters/US/Medic.et                | SCR_ChimeraCharacter     | US Medic            |
| Prefabs/Vehicles/UAZ_469.et                   | Vehicle_Wheeled          | UAZ-469 (US)        |
```

**Known limit:** reads the literal `"faction affiliation"` property on `SCR_FactionAffiliationComponent`. Does NOT resolve affiliations inherited from a parent prefab — that would require an inheritance walk (not supported here; use `prefab` with `action=inspect` for that).

### project_validate scope=faction

The omnibus `project_validate` tool runs a faction-specific lint when called with `scope: "faction"`. Rules F1-F5:

- **F1** — required fields present (`m_sFactionKey`, `m_sFactionName`)
- **F2** — `m_sFactionKey` shape matches `^[A-Z][A-Z0-9_]{1,15}$`
- **F3** — `m_FactionColor` R/G/B/A all in `[0, 255]`
- **F4** — no duplicate faction keys within the project
- **F5** — no orphan factions (faction is defined but not referenced by any entity)

**Input:**

```json
{ "scope": "faction", "target": "C:/.../addons/MyMod" }
```

The `target` may be either a single `.conf` file (runs F1-F3 only) or a project root directory (runs all five). When run against a directory, walks `Configs/Factions/*.conf` to discover the factions and cross-references against the project's `.et` / `.conf` files for F5.

**Sample output:**

```
project_validate scope=faction: MyMod

3 findings:

[E] Configs/Factions/INVALID.conf (F2): faction_key "invalid_lower" does not match required shape
[W] Configs/Factions/ORPHAN.conf (F5): faction "ORPHAN" defined but not referenced by any entity
[W] Configs/Factions/US.conf (F3): m_FactionColor.r = 300, out of range [0, 255]
```

## Workflow: building a new Conflict scenario from scratch

A sequence that exercises this cluster end-to-end:

1. **`faction_create`** — scaffold any new factions you need.
2. **`project_validate scope=faction`** — sanity-check the faction set.
3. **`scenario_create_conflict`** — generate the scenario skeleton (`.conf` + `.ent` + layer files).
4. **`scenario_apply_template`** — stamp `fob_basic` / `checkpoint` / `patrol_grid` patterns at key positions.
5. **`refactor_replace_guid`** — replace the template's sentinel GUIDs with real prefab refs.
6. **`scenario_inspect`** — confirm the structure parses cleanly.
7. **`gm_spawn_list_export`** — verify the GM catalog covers the factions in the scenario.
8. **`wb_launch` → `scenario_create`** — add per-objective entities live, snap to terrain.
9. **`scenario_diff` (vs the previous version)** — confirm what changed before merging Beta-Branch → main.
