# Conflict Layer Reference

Quick-reference for layer file names, entity types, and prefab GUIDs used in production Conflict/Seize mods. Sourced from analysis of ConflictEscalation, SeizeAMPSecure, TheConflictIsles, ConflictPVERemixedVanilla, LinearConflictPVE (2,000+ layer files across 7 mods).

---

## Full Layer Taxonomy

### Core (always required)

| Layer file                                | Content                                                       | Notes                                                 |
| ----------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| `default.layer`                           | Game mode, faction manager, AI world, radio manager, managers | See `conflict-scenario-setup.md` for full entity list |
| `Bases.layer`                             | All `ConflictMilitaryBase.et` in one `$grp` block             | Named entity blocks per base                          |
| `CAH.layer`                               | `SCR_CaptureAndHoldArea` trigger volumes for major bases      | Referenced by `m_aCaptureAndHoldAreaNames`            |
| `Defenders.layer` / `FIA_Defenders.layer` | Faction patrol spawnpoints with `SCR_DefendWaypoint` child    | One `$grp` per faction                                |

### AI Spawning

| Layer file                                                         | Content                                               | Key properties                                                   |
| ------------------------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------- |
| `AmbientPatrolSpawnpoints.layer`                                   | `AmbientPatrolSpawnpoint_Base.et` or faction variants | `m_bPickRandomGroupType 1`, `m_iRespawnPeriod 600`               |
| `AmbientVehicleSpawnpoints.layer`                                  | `AmbientVehicleSpawnpoint_CIV.et`                     | `m_aIncludedEditableEntityLabels` filter; `m_iRespawnPeriod 600` |
| `FIA_Vehicles.layer` / `US_Vehicles.layer` / `USSR_Vehicles.layer` | Faction-specific vehicle spawners                     | Use faction prefab variant to avoid setting affiliation manually |
| `AUTO_Veh_Spawns_*.layer`                                          | `IRON_AmbientVehicleSpawnpoint_Base_Auto.et`          | ConflictEscalation — auto-detects faction from nearest base      |
| `AmbientPatrols_SEEDING.layer`                                     | `IRON_AmbientPatrolSpawnpoint_Base_Seeding.et`        | Only spawns below player threshold (`m_iRespawnPeriod 90`)       |
| `AmbientPatrols_AUTO.layer`                                        | `SCR_Iron_AmbientPatrolSpawnPointComponent_Auto`      | Auto-faction, checks `GetIsPatrolNearMainBaseAllowed()`          |

### Supply System

| Layer file            | Content                                                  | Notes                                                                              |
| --------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `Supplies.layer`      | Supply cache composition prefabs                         | e.g. `SupplyCache_S_FIA_01.et`–`06.et` (visual variants, no functional difference) |
| `SuppliesLogic.layer` | `CampaignRemnantsSupplyDepot.et` with embedded patrol AI | Depots for player-built bases; often has nested defenders                          |
| `Harbors.layer`       | `ConflictSourceBase_T1/T3Harbor.et` in `$grp`            | Uses `SCR_CampaignSourceBaseComponent`; see Harbor section in setup guide          |
| `SupplyDepots.layer`  | Scatter supply caches across map                         | Multiple cache variants for visual variety                                         |

### Base Buildings & Fortifications

| Layer file                     | Content                                                                           | Notes                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `BaseLogic.layer`              | Composition prefabs like `Base_LevieMilitary_FIA_01.et`, `Base_Airport_FIA_01.et` | Places buildings at specific map locations; separate from base logic entities |
| `DefenderFortifications.layer` | Sandbags, MG nests, barricades, bunkers                                           | Static decorative + defensive objects near base perimeters                    |
| `MOB_Barrier.layer`            | Checkpoint compositions, barricades around MOB perimeter                          | `SlotRoadSmall`, `SlotRoadMedium` slotted prefabs                             |
| `Minefields.layer`             | Minefield composition prefabs                                                     | Near base perimeters; gameplay markers                                        |
| `Roadblocks.layer`             | Road checkpoint compositions + optional turrets                                   | `Checkpoint_S_USSR_01.et`, `Checkpoint_M_USSR_01.et`                          |

### MOB-Specific

| Layer file                                        | Content                                      | Notes                                                                     |
| ------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| `MOBs.layer` / `StartingPositions.layer`          | MOB base entities (split from `Bases.layer`) | Includes `IRON_SeedingRestrictionZoneEntity`, `MOBSpawnProtectionArea.et` |
| `MOB1_Veh_Spawns.layer` / `MOB2_Veh_Spawns.layer` | Vehicle spawns linked to specific MOB        | Placed close to MOB entity                                                |

### Seeding & Low-Pop Support

| Layer file             | Content                                                                                                      | Notes                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `SeedingPvpZone.layer` | Seeding patrols + `SCR_CampaignSpawnPointGroup` with `m_bOnlyShowDuringSeeding 1` + `SCR_CaptureAndHoldArea` | Active only during low-player phase; keeps server alive |
| `SeedingSpawns.layer`  | `SCR_CampaignSpawnPointGroup` spawn groups with `m_bOnlyShowDuringSeeding 1`                                 | Player spawn points only shown during seeding           |

### Scenario Framework Overlay (SF on top of Conflict)

| Layer file            | Purpose                                                    |
| --------------------- | ---------------------------------------------------------- |
| `SF_Missions.layer`   | SF objective areas with `ON_TRIGGER_ACTIVATION` activation |
| `SF_Patrols.layer`    | SF patrol spawn points linked to objective areas           |
| `SF_QRF.layer`        | Quick Reaction Force AI reinforcement                      |
| `SF_Roadblocks.layer` | Enemy-controlled checkpoint entities                       |
| `Markers.layer`       | Map marker entities (`SCR_ScenarioFrameworkSlotMarker`)    |

### Cosmetic

| Layer file         | Content                          |
| ------------------ | -------------------------------- |
| `Objects.layer`    | Props, debris, decorations       |
| `Posters.layer`    | Propaganda poster props          |
| `Clutter.layer`    | Ambient clutter objects          |
| `Electrical.layer` | Power/comms infrastructure props |

### Advanced / Optional

| Layer file                                     | Content                                                        | Notes                                                |
| ---------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------- |
| `AmbientAIZone.layer` / `AmbientAIZones.layer` | AI zone entities for ambient battle simulation                 | Requires `m_bEnableAmbientAIBattles 1` on game mode  |
| `RelayTowers.layer`                            | `ConflictRelayRadio.et` placements between distant bases       | Extend radio coverage network                        |
| `WorldSetup_Logic.layer`                       | `SCR_AIWorld`, perception, camera, radio, fog, post-processing | Only needed if not provided by parent SubScene world |
| `zImport.layer`                                | Legacy scratch layer                                           | Always empty; ignore                                 |

---

## Prefab GUID Reference

### Military Bases

| GUID                 | Prefab                            | Use                                                 |
| -------------------- | --------------------------------- | --------------------------------------------------- |
| `{1391CE8C0E255636}` | `ConflictMilitaryBase.et`         | ALL conflict bases (MOBs, control points, standard) |
| `{8BEE4B0606893CDF}` | `ConflictSourceBase_T1Harbor.et`  | Small harbor — low supply income                    |
| `{0226331FB6A8249A}` | `ConflictSourceBase_T3Harbor.et`  | Large harbor — high supply income                   |
| `{1739B43A3702BB84}` | `ConflictSourceBase_Airfield.et`  | Airfield supply source                              |
| `{CE6DD1D3C1BC7366}` | `GameMode_Seize.et`               | Conflict game mode                                  |
| `{F1AC26310BAE3788}` | `CampaignFactionManager_Seize.et` | Faction manager                                     |
| `{35C70C8528D145B1}` | `MOBSpawnProtectionArea.et`       | MOB player spawn safety zone                        |
| `{D71F66A96E03FE7C}` | `SCR_BattlePrepZone.et`           | Battle prep safe zone at match start                |
| `{27941CDF3E7E1A5F}` | `CampaignRemnantsSupplyDepot.et`  | Supply drop point for player-built bases            |

### Ambient Patrols

| GUID                 | Prefab                                         | Faction                                   |
| -------------------- | ---------------------------------------------- | ----------------------------------------- |
| `{1E4C8AD00BBB16AA}` | `AmbientPatrolSpawnpoint_Base.et`              | Generic base (no faction preset)          |
| `{9273AB931008C271}` | `AmbientPatrolSpawnpoint_FIA.et`               | FIA                                       |
| `{0E66F798F84EEB58}` | `IRON_AmbientPatrolSpawnpoint_Base_Seeding.et` | Seeding-only spawns                       |
| `{EB835D24922D2A23}` | `IRON_AmbientVehicleSpawnpoint_Base_Auto.et`   | Auto-faction vehicle (ConflictEscalation) |

### Ambient Vehicles

| GUID                 | Prefab                             | Faction  |
| -------------------- | ---------------------------------- | -------- |
| `{67EE7343073E3AF4}` | `AmbientVehicleSpawnpoint_US.et`   | US       |
| `{644AEC5C537E03F0}` | `AmbientVehicleSpawnpoint_USSR.et` | USSR     |
| `{D4A604DD154470CD}` | `AmbientVehicleSpawnpoint_FIA.et`  | FIA      |
| `{0DDAFCA92FF4451C}` | `AmbientVehicleSpawnpoint_CIV.et`  | Civilian |

### Waypoints

| GUID                 | Prefab                                        | Use                                             |
| -------------------- | --------------------------------------------- | ----------------------------------------------- |
| `{AAE8882E0DE0761A}` | `AIWaypoint_Defend_Hierarchy.et`              | Hierarchical defend (standard defender pattern) |
| `{FBA8DC8FDA0E770D}` | `AIWaypoint_Patrol_Hierarchy.et`              | Patrol route                                    |
| `{93291E72AC23930F}` | `AIWaypoint_Defend.et`                        | Single defend point                             |
| `{06B1B14B6DE3C983}` | `AIWaypoint_Defend_ConflictBaseTeamPatrol.et` | Conflict base team patrol                       |
| `{2A81753527971941}` | `AIWaypoint_Defend_CP.et`                     | Control point defence                           |

### Defensive Compositions

| GUID                 | Prefab                            | Size   |
| -------------------- | --------------------------------- | ------ |
| `{7492BAA88AFCEDCE}` | `Bunker_S_USSR_01.et`             | Small  |
| `{114DE81321786CD9}` | `MachineGunNest_S_USSR_01_PKM.et` | Small  |
| `{7C85836D444E3797}` | `Checkpoint_M_USSR_01.et`         | Medium |
| `{9483333BFD9E2D0F}` | `Checkpoint_S_USSR_01.et`         | Small  |
| `{83A10E8547281E58}` | `Barricade_S_USSR_01.et`          | Small  |

### Supply Caches (visual variants — no functional difference)

| GUID                 | Prefab                    |
| -------------------- | ------------------------- |
| `{AB1A97B1BAE8C395}` | `SupplyCache_S_FIA_01.et` |
| `{22D2EFA80AC9DBD0}` | `SupplyCache_S_FIA_03.et` |
| `{1FE6CA907FA552E7}` | `SupplyCache_S_FIA_04.et` |
| `{FA7A86697340C58C}` | `SupplyCache_S_FIA_05.et` |
| `{962EB289CF844AA2}` | `SupplyCache_S_FIA_06.et` |

### World Setup Infrastructure

| GUID                 | Prefab                      | Purpose                    |
| -------------------- | --------------------------- | -------------------------- |
| `{E0A05C76552E7F58}` | `SCR_AIWorld.et`            | AI navmesh + pathfinding   |
| `{028DAEAD63E056BE}` | `PerceptionManager.et`      | Perception system          |
| `{33F9FD881E3700CC}` | `SCR_CameraManager.et`      | Camera control             |
| `{B8E09FAB91C4ECCD}` | `RadioManager.et`           | Radio communication system |
| `{66B93BC296E2F977}` | `RadioBroadcastManager.et`  | Radio broadcast handling   |
| `{3AFFB0B0EC055284}` | `GenericWorldPP_Default.et` | Post-processing effects    |
| `{78D9BBF0F423FEB4}` | `FogHaze_Default.et`        | Atmosphere/fog             |

---

## Component Configuration Reference

### `SCR_AmbientPatrolSpawnPointComponent`

```
m_bPickRandomGroupType 1      // random group type each spawn
m_iRespawnPeriod 600          // seconds between spawns
m_fAILimitThreshold 0.33      // light patrol (sparse AI)
m_fAILimitThreshold 0.66      // standard patrol (spawn up to 66% of AI limit)
m_eGroupType FIRETEAM         // fixed type (omit if using m_bPickRandomGroupType)
m_iSpawnDistanceOverride 400  // custom spawn-in distance
m_iDespawnDistanceOverride 500 // custom despawn distance
```

### `SCR_AmbientVehicleSpawnPointComponent`

```
m_iRespawnPeriod 600
m_aIncludedEditableEntityLabels {
 TRAIT_PASSENGERS_SMALL
 TRAIT_PASSENGERS_LARGE
}
m_aExcludedEditableEntityLabels {
 VEHICLE_HELICOPTER
 VEHICLE_AIRPLANE
 53   // heavy vehicles
}
```

### `SCR_CampaignMilitaryBaseComponent` (key properties by role)

| Property                      | MOB    | Major  | Standard | Control Point |
| ----------------------------- | ------ | ------ | -------- | ------------- |
| `m_bCanBeHQ`                  | `1`    | —      | —        | —             |
| `m_bIsControlPoint`           | `1`    | `1`    | —        | `1`           |
| `m_bIsSupplyHub`              | `1`    | `1`    | —        | —             |
| `m_bExcludeFromRandomization` | `1`    | `1`    | —        | —             |
| `m_fRadioAntennaServiceRange` | `1000` | `1470` | `1470`   | `1470`        |

### `SCR_CampaignSuppliesComponent` (by role)

| Role                | `m_iSupplies` | `m_iSuppliesMax` |
| ------------------- | ------------- | ---------------- |
| MOB (starting)      | `500`         | `3000`           |
| Major base          | omit          | omit             |
| Standard base       | omit          | omit             |
| MOB (fully stocked) | `3000`        | `3000`           |

**Note:** Production mods typically give MOBs only `500` starting supplies, not `3000`. The `3000` max applies to the cap.

### `SCR_CoverageRadioComponent` (radio range by role)

| Role                     | `m_fRadioAntennaServiceRange` |
| ------------------------ | ----------------------------- |
| MOB / HQ                 | `1000`                        |
| Harbor / Airfield source | `680`–`700`                   |
| Standard base            | `1470`                        |
| Control point            | `1470`                        |

---

## Production Design Patterns

### Layer naming conventions

- Split large maps: `BasesNorth.layer`, `BasesSouth.layer`, `BasesCentral.layer`
- Per-faction vehicle layers: `FIA_Vehicles.layer`, `US_Vehicles.layer`
- Per-MOB vehicle layers: `MOB1_Veh_Spawns.layer`, `MOB2_Veh_Spawns.layer`
- Enables selective enabling/disabling per scenario variant

### AI threshold tuning

- `m_fAILimitThreshold 0.33` — sparse patrols (low-pop or PvP servers)
- `m_fAILimitThreshold 0.66` — standard density
- Prevents lag from exceeding the AI world limit silently

### Supply scarcity design

- MOBs start with `500` supplies (not `3000`) — forces supply management from day 1
- Control points: `3000` max — high capture reward
- Regular bases: often no `SCR_CampaignSuppliesComponent` (uses game mode's `m_iRegularSuppliesIncome`)

### Seeding restriction zones

`IRON_SeedingRestrictionZoneEntity : "{801DADF0D6C316B9}PrefabsEditable/RestrictionZone/E_SeedingRestrictionZoneBase.et"` — restricts players to MOB area during seeding. Add as child entity to MOB with `m_bAutoSizeToHQ 1`.

### CAH symbol convention

`m_sAreaSymbol "#AR-CAH-Area_Symbol_A"` through `_U` (letters A–U for map display). Each CAH zone in a major base gets a unique letter. Start at A within each base.
