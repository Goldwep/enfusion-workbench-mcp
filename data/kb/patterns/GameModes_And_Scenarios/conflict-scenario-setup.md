# Conflict Multiplayer Scenario Setup

Scenario Framework (SF) is for single-player/co-op narrative missions.
**Multiplayer scenarios use `SCR_GameModeCampaign` (Conflict game mode)** — not `GameModeSF.et`.
All popular Workshop mods (ConflictEscalation, LinearConflictPVE, SeizeAMPSecure, TheConflictIsles, etc.) build on this stack.

---

## MCP Tools

| Goal                             | Tool                                        |
| -------------------------------- | ------------------------------------------- |
| Generate complete scenario files | `scenario_create_conflict`                  |
| Place a base interactively in WB | `scenario_create_base`                      |
| Generate mission header only     | `config_create configType:"mission-header"` |

---

## Mission Header (`SCR_MissionHeaderCampaign`)

Located in `Missions/YourScenario.conf`. Exact format from vanilla `Conflict_East.conf`:

```
SCR_MissionHeaderCampaign {
 World "{9DF143A76F5C6460}worlds/MP/CTI_Campaign_Eden.ent"
 SystemsConfig "{7C9E720397CC6ACD}Configs/Systems/ConflictSystems.conf"
 m_sName "My Scenario"
 m_sDescription "Description shown in mission browser"
 m_sGameMode "Conflict"
 m_iPlayerCount 40
 m_eEditableGameFlags 6
 m_eDefaultGameFlags 6
 m_bIsSavingEnabled 1
 m_bCustomBaseWhitelist 1
 m_aCampaignCustomBaseList {
  SCR_CampaignCustomBase "{ENTITY_GUID}" {
   m_sBaseName "BaseAlpha"
  }
  SCR_CampaignCustomBase "{ENTITY_GUID}" {
   m_sBaseName "ControlPoint1"
   m_bIsControlPoint 1
  }
 }
}
```

Key properties:

- `World` — resource ref to the world `.ent` file (the SubScene)
- `SystemsConfig` — always `{7C9E720397CC6ACD}Configs/Systems/ConflictSystems.conf`
- `m_bCustomBaseWhitelist 1` + `m_aCampaignCustomBaseList` — restricts which world bases are active; `m_sBaseName` must match `SCR_CampaignMilitaryBaseComponent.m_sBaseName` exactly (case-sensitive)
- `m_bIsControlPoint 1` — marks a base as a numbered capture point on the map
- `m_fXpMultiplier 0.5` — use for PvE scenarios; omit for standard (1.0)

### Known world GUIDs:

| Map            | Resource ref                                                 |
| -------------- | ------------------------------------------------------------ |
| Everon (full)  | `{853E92315D1D9EFE}worlds/Eden/Eden.ent`                     |
| Arland         | `{DC924A8DDECC73AD}worlds/MP/CTI_Campaign_Arland.ent`        |
| Western Everon | `{312CDBA105554B51}worlds/MP/CTI_Campaign_WesternEveron.ent` |

The `World` property in the `.conf` should point to your own SubScene `.ent`, not the vanilla world directly.

### Supply source prefab GUIDs:

| GUID                 | Prefab                           | Notes                              |
| -------------------- | -------------------------------- | ---------------------------------- |
| `{8BEE4B0606893CDF}` | `ConflictSourceBase_T1Harbor.et` | Small harbor — lower supply income |
| `{0226331FB6A8249A}` | `ConflictSourceBase_T3Harbor.et` | Large harbor — high supply income  |
| `{1739B43A3702BB84}` | `ConflictSourceBase_Airfield.et` | Airfield supply source             |

### Faction-specific vehicle spawn GUIDs:

| GUID                 | Prefab                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `{67EE7343073E3AF4}` | `AmbientVehicleSpawnpoint_US.et`                                                                      |
| `{644AEC5C537E03F0}` | `AmbientVehicleSpawnpoint_USSR.et`                                                                    |
| `{D4A604DD154470CD}` | `AmbientVehicleSpawnpoint_FIA.et`                                                                     |
| `{0DDAFCA92FF4451C}` | `AmbientVehicleSpawnpoint_CIV.et`                                                                     |
| `{EB835D24922D2A23}` | `IRON_AmbientVehicleSpawnpoint_Base_Auto.et` (ConflictEscalation — auto-detects nearest base faction) |

---

## World File + Layer Structure

Production mods use a **layer-based** structure, not a single `.ent` with all entities inline. The `.ent` file is a minimal SubScene stub — all content lives in layer files.

### `Worlds/MyScenario.ent` (SubScene stub):

```
SubScene {
 Parent "{853E92315D1D9EFE}worlds/Eden/Eden.ent"
}
```

### `Worlds/MyScenario_Layers/default.layer` (game mode + managers):

```
SCR_GameModeCampaign GameMode1 : "{CE6DD1D3C1BC7366}Prefabs/GameLogic/GameMode_Seize.et" {
 m_fAutoReloadTime 30
 m_iControlPointsThreshold 5
 m_fVictoryTimer 300
 m_bEstablishingBasesEnabled 0
}
SCR_CampaignFactionManager CampaignFactionManager1 : "{F1AC26310BAE3788}Prefabs/MP/Campaign/CampaignFactionManager_Seize.et" {
}
```

### `Worlds/MyScenario_Layers/Bases.layer` (all bases):

```
$grp GenericEntity : "{1391CE8C0E255636}Prefabs/Systems/MilitaryBase/ConflictMilitaryBase.et" {
 BaseAlpha {
  components {
   SCR_CampaignSeizingComponent "{5C66967235FBEEA3}" {
    m_fMaximumSeizingTime 120
    m_fMinimumSeizingTime 30
    m_RequiredGroupTypes { ASSAULT SF_ASSAULT }
   }
   SCR_CoverageRadioComponent "{5C669673C2A82A2B}" {
    Transceivers { RelayTransceiver "{5C669673E8C94083}" { } }
   }
   SCR_CampaignMilitaryBaseComponent "{5AFC974A70234D1C}" {
    m_sBaseName "BaseAlpha"
    m_sBaseNameUpper "BASEALPHA"
    m_fRadioAntennaServiceRange 1470
   }
  }
  coords 1000 0 2000
 }
}
```

In Workbench: File → New World → **Sub-scene (of current world)** → save to `Worlds/` in your mod. Add layers via the Layers panel.

---

## Required Entities in a Conflict World

| Entity           | Prefab GUID                                                                    | Layer          | Notes                             |
| ---------------- | ------------------------------------------------------------------------------ | -------------- | --------------------------------- |
| Game mode        | `{CE6DD1D3C1BC7366}Prefabs/GameLogic/GameMode_Seize.et`                        | default.layer  | One per world                     |
| Faction manager  | `{F1AC26310BAE3788}Prefabs/MP/Campaign/CampaignFactionManager_Seize.et`        | default.layer  | Manages US/USSR/FIA               |
| Military bases   | `{1391CE8C0E255636}Prefabs/Systems/MilitaryBase/ConflictMilitaryBase.et`       | Bases.layer    | All in one `$grp` block           |
| Relay radios     | `{522DCD528AE27052}Prefabs/Systems/MilitaryBase/ConflictRelayRadio.et`         | Bases.layer    | Optional — extend coverage        |
| Battle prep zone | `{D71F66A96E03FE7C}Prefabs/GameLogic/SCR_BattlePrepZone.et`                    | default.layer  | Optional safe zone at match start |
| Supply depot     | `{27941CDF3E7E1A5F}Prefabs/Systems/SupplyDepot/CampaignRemnantsSupplyDepot.et` | Supplies.layer | Drop point for player-built bases |

---

## Military Base Types

All bases use **`ConflictMilitaryBase.et`** (`{1391CE8C0E255636}`) in a `$grp GenericEntity` block. Type is determined by which components you configure on the instance.

| Role                       | How to configure                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standard town/small base   | `SCR_CampaignSeizingComponent` enabled, no CAH, no `m_bCanBeHQ`                                                                                                                    |
| Major base (harbour, port) | `SCR_CampaignSeizingComponent` with `m_bRequiresCaptureAndHoldAreas 1` + CAH names, `m_bIsControlPoint 1`, `m_bIsSupplyHub 1`                                                      |
| MOB / HQ                   | `SCR_CampaignSeizingComponent Enabled 0`, `m_bCanBeHQ 1`, `m_bIsSupplyHub 1`, radio `m_bIsSource 1`, `SCR_CampaignSuppliesComponent m_iSupplies 500` (starting), radio range 1000m |
| Relay radio tower          | Use `ConflictRelayRadio.et` — different prefab, just radio + base name component                                                                                                   |

**Radio range by role (from production mods):**

- MOBs: `m_fRadioAntennaServiceRange 1000` — widest coverage as strategic HQ
- Supply sources (harbors, airfields): `680`–`700` — local coverage
- Standard bases: `1470` — standard balanced default
- Control points: `1470` or omit (no radio source)

Key `SCR_CampaignMilitaryBaseComponent` properties:

- `m_sBaseName` — must match mission header whitelist entry (case-sensitive)
- `m_sBaseNameUpper` — uppercase version for UI display
- `m_bCanBeHQ 1` — MOB/HQ flag
- `m_bIsControlPoint 1` — marks as numbered capture objective on map
- `m_bIsSupplyHub 1` — allows supply delivery
- `m_fRadioAntennaServiceRange 1470` — default for all bases (1470m from mod analysis)
- `m_bExcludeFromRandomization 1` — fixed bases not randomized (MOBs, airfields, harbors)

`SCR_CampaignSeizingComponent` key properties:

- `m_fMaximumSeizingTime 120` / `m_fMinimumSeizingTime 30` — standard values from mods
- `m_iRadius 150-300` — major bases set this; small bases omit (uses prefab default)
- `m_bRequiresCaptureAndHoldAreas 1` + `m_aCaptureAndHoldAreaNames` — requires specific CAH zones to be controlled
- `m_RequiredGroupTypes { ASSAULT SF_ASSAULT }` — always present
- `Enabled 0` — on MOBs

`SCR_CoverageRadioComponent` (required on all bases):

- `Transceivers { RelayTransceiver "{5C669673E8C94083}" { } }` — always present
- `m_bIsSource 1` — on MOBs only
- `m_bIsOnIsland 1` — on island MOBs
- `m_bIsReceivingFromIsland 1` — on mainland bases near island MOB coverage
- `m_aAssignedBaseNames` — explicit radio assignment override

---

## Layer Taxonomy

Every Conflict world uses a SubScene `.ent` stub + a `_Layers/` folder. Standard layer names and contents from production mods:

### Core (always required)

| Layer file                                      | Content                                                                                                               | Notes                                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `default.layer`                                 | Game mode entity, AI world (navmesh), radio manager, faction manager, preload manager, loadout manager, music manager | Game mode prefab varies: `GameMode_Seize.et` (standard), `GameMode_Escalation_Base.et` (ConflictEscalation custom) |
| `Bases.layer`                                   | All `ConflictMilitaryBase.et` in one `$grp` block                                                                     | Named entity blocks per base                                                                                       |
| `StartingPos.layer` / `StartingPositions.layer` | MOB bases — often split from regular bases                                                                            | Includes `IRON_SeedingRestrictionZoneEntity`, `SCR_CampaignSuppliesComponent`                                      |
| `CAH.layer`                                     | `SCR_CaptureAndHoldArea` trigger volumes                                                                              | One per capture zone; referenced by `m_aCaptureAndHoldAreaNames` on major bases                                    |

### AI Spawning

| Layer file                                       | Content                                                                                   | Key properties                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `AmbientPatrolSpawnpoints.layer`                 | `AmbientPatrolSpawnpoint_Base.et` or faction variants                                     | `m_bPickRandomGroupType 1`, `m_iRespawnPeriod 600`               |
| `FIA_Defenders.layer` / `BaseDefenders.layer`    | Faction patrol spawnpoints with `SCR_DefendWaypoint` child                                | Defender AI has `SCR_DefendWaypoint` child entity defining area  |
| `AmbientVehicleSpawnpoints.layer`                | `AmbientVehicleSpawnpoint_CIV.et`                                                         | `m_aIncludedEditableEntityLabels` filter; `m_iRespawnPeriod 600` |
| `FIA_Vehicles.layer` / `AUTO_Veh_Spawns_*.layer` | `AmbientVehicleSpawnpoint_FIA/US/USSR.et` or `IRON_AmbientVehicleSpawnpoint_Base_Auto.et` | Per-faction or per-location vehicle spawns                       |
| `AmbientPatrols_SEEDING.layer`                   | `IRON_AmbientPatrolSpawnpoint_Base_Seeding.et`                                            | Only active below player threshold; used for seeding phase AI    |

### Supply System

| Layer file            | Content                                                         | Notes                                                                                                      |
| --------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `Supplies.layer`      | Supply cache composition prefabs (location-specific or generic) | e.g. `SupplyCache_Morton_FIA_01.et` — named-location supply compositions exist per map                     |
| `SuppliesLogic.layer` | `CampaignRemnantsSupplyDepot.et` with embedded patrol AI inside | Supply depots that have their own nested defenders                                                         |
| `Harbors.layer`       | `ConflictSourceBase_T3Harbor.et` in `$grp`                      | Uses `SCR_CampaignSourceBaseComponent` (not `SCR_CampaignMilitaryBaseComponent`); see Harbor section below |

### Base Buildings & Fortifications

| Layer file                     | Content                                                                               | Notes                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `BaseLogic.layer`              | **Composition prefabs** like `Base_LevieMilitary_FIA_01.et`, `Base_Airport_FIA_01.et` | Places actual buildings + barracks at named map locations; separate from base entity logic       |
| `DefenderFortifications.layer` | Sandbag positions, MG nests, camo nets                                                | Static defensive objects; use `SandbagPosition_S_USSR_03.et`, `MachineGunNest_S_USSR_01.et` etc. |
| `Minefields.layer`             | Minefield composition prefabs                                                         | Placed near base perimeters                                                                      |

### Cosmetic

| Layer file      | Content                    |
| --------------- | -------------------------- |
| `Objects.layer` | Props, debris, decorations |
| `Posters.layer` | Propaganda poster props    |
| `Markers.layer` | Map marker entities        |
| `Clutter.layer` | Ambient clutter objects    |

### Advanced / Optional

| Layer file                                            | Content                                                                                                        | Notes                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `SeedingPvpZone.layer`                                | Seeding patrol AI + `SCR_CampaignSpawnPointGroup` with `m_bOnlyShowDuringSeeding 1` + `SCR_CaptureAndHoldArea` | Active only during low-pop seeding; keeps server alive               |
| `MOBs.layer`                                          | MOB base entities split from `Bases.layer`                                                                     | Some mods (NorthEver) separate MOBs for clarity                      |
| `SF.layer` / `SF_Missions.layer` / `SF_Patrols.layer` | Scenario Framework entities embedded in a Conflict world                                                       | ConflictEscalation AAD variant adds SF objectives on top of Conflict |
| `AmbientAIZone.layer` / `AmbientAIZones.layer`        | AI zone entities for ambient battle simulation                                                                 | Requires `m_bEnableAmbientAIBattles 1` on game mode                  |
| `RelayTowers.layer`                                   | Pre-placed fortification compositions with `SCR_CampaignBuildingCompositionComponent`                          | Relay tower positions as spawned compositions                        |
| `zImport.layer`                                       | Legacy scratch/import layer                                                                                    | Always empty or near-empty; can ignore                               |

---

## WorldSetup_Logic.layer — World Infrastructure

Some mods split the low-level world infrastructure into a separate `WorldSetup_Logic.layer` (distinct from `default.layer`). These entities are required for a functional world:

```
SCR_AIWorld : "{E0A05C76552E7F58}Prefabs/AI/SCR_AIWorld.et" {
 NavmeshWorldComponent {
  ResourceName ".nmn"  // navmesh file, generated by Workbench
 }
}
GenericWorldPP_Default : "{3AFFB0B0EC055284}Prefabs/World/Misc/GenericWorldPP_Default.et" {
 coords 0 0 0
}
FogHaze_Default : "{78D9BBF0F423FEB4}Prefabs/World/Misc/FogHaze_Default.et" {
 coords 0 0 0
}
PerceptionManager : "{028DAEAD63E056BE}Prefabs/World/Game/PerceptionManager.et" {
 coords 0 0 0
}
SCR_CameraManager : "{33F9FD881E3700CC}Prefabs/World/Game/SCR_CameraManager.et" {
 coords 0 0 0
}
RadioManagerEntity : "{B8E09FAB91C4ECCD}Prefabs/Systems/Radio/RadioManager.et" {
 coords 0 0 0
}
RadioBroadcastManager : "{66B93BC296E2F977}Prefabs/Systems/Radio/RadioBroadcastManager.et" {
 coords 0 0 0
}
```

When inheriting a vanilla world as SubScene, most of these are already provided by the parent. Only add explicitly if you need to override them.

---

## default.layer — Full Entity List

All entities that belong in `default.layer`:

```
SCR_AIWorld : "{E0A05C76552E7F58}Prefabs/AI/SCR_AIWorld.et" { ... navmesh config ... }
PerceptionManager : "{028DAEAD63E056BE}Prefabs/World/Game/PerceptionManager.et" { coords ... }
RadioManagerEntity : "{B8E09FAB91C4ECCD}Prefabs/Systems/Radio/RadioManager.et" { coords ... }
ScriptedChatEntity : "{536D80EB494DDC43}Prefabs/MP/Campaign/CampaignMPChatEntity.et" { coords ... }
SCR_GameModeCampaign GameMode1 : "{CE6DD1D3C1BC7366}Prefabs/GameLogic/GameMode_Seize.et" { ... }
SCR_CampaignFactionManager CampaignFactionManager1 : "{F1AC26310BAE3788}Prefabs/MP/Campaign/CampaignFactionManager_Seize.et" { coords ... }
BasePreloadManager PreloadManager1 : "{0E26864C62DBCA39}Prefabs/MP/CaptureAndHoldPreloadManager.et" { coords ... }
SCR_BaseTaskManager TaskManager1 : "{17E3EF2CF455460F}Prefabs/MP/Campaign/CampaignTaskManager.et" { coords ... }
ItemPreviewManagerEntity : "{9F18C476AB860F3B}Prefabs/World/Game/ItemPreviewManager.et" { coords ... }
MusicManager : "{359452CCDBDD03F5}Prefabs/Sounds/Music/MusicManager_Campaign.et" { coords ... }
SCR_LoadoutManager : "{B6057D90BDD5BEE9}Prefabs/MP/Campaign/CampaignLoadoutManager_Seize.et" { coords ... }
```

`GameMode_Seize.et` key properties:

- `m_iControlPointsThreshold` — bases enemy must hold to start victory timer (default 2-5)
- `m_fVictoryTimer` — seconds after threshold reached before win (default 300)
- `m_fAutoReloadTime` — mission restart delay after end (default 30)
- `m_iRegularSuppliesIncome` — passive supply income per interval (default 50)
- `m_bEstablishingBasesEnabled 0` — disable for simple scenarios
- `m_bRandomizeBases 1` + `m_iRandomizeTreshold` — randomize which bases are active
- `m_bHideBasesOutsideRadioRange 1` — standard for most scenarios
- `m_bShowBattlePrepTimer 1` — show prep timer at start
- `m_bScaleRespawnTimer 1` — scale respawn time by player count
- `m_bServerSeedingEnabled 1` + `m_iServerSeedingThreshold` — seeding mode (ConflictEscalation)
- `m_bEnableAmbientAIBattles 1` — ambient AI zones active (ConflictEscalation)

---

## CAH Layer (Capture and Hold Areas)

`SCR_CaptureAndHoldArea` entities define the physical zones for major base capture. Referenced by `m_aCaptureAndHoldAreaNames` on `SCR_CampaignSeizingComponent`.

```
$grp SCR_CaptureAndHoldArea : "{F4649500E51DF810}Prefabs/MP/Modes/CaptureAndHold/Areas/CaptureAndHoldArea_Major.et" {
 CAH_Airfield_A {
  coords 4900 27 11800
  TriggerShapeType Sphere
  SphereRadius 40
  DrawShape 0
  m_sAreaSymbol "#AR-CAH-Area_Symbol_A"
 }
 CAH_Airfield_B {
  coords 4870 27 11840
  TriggerShapeType Sphere
  SphereRadius 35
  DrawShape 0
  m_sAreaSymbol "#AR-CAH-Area_Symbol_B"
 }
}
```

- Names must match strings in `m_aCaptureAndHoldAreaNames` array on the base exactly
- Symbol keys: `#AR-CAH-Area_Symbol_A` through `_U` (lettered for map display)
- `DrawShape 0` — hide debug shape in game
- `m_bEnableScoring 0` — set when CAH is for territory control only, not scoring

---

## Harbor / Source Base Layer

Harbors use a **different prefab family** from regular bases:

```
$grp GenericEntity : "{0226331FB6A8249A}Prefabs/Systems/MilitaryBase/ConflictSourceBase_T3Harbor.et" {
 HarborName {
  components {
   SCR_CampaignSeizingComponent "{621EB97024DABABE}" {
    m_fSupplyMultiplier 0
   }
   SCR_CampaignSourceBaseComponent "{621EB97024DABD3C}" {
    m_bExcludeFromRandomization 1
    m_iScorePerTick 0
    m_bExcludeFromBaseCaptureScore 1
   }
  }
  coords 5803 2 3533
  angles 0 -138 0
 }
}
```

Harbor prefab tiers (supply income scales with tier):

- `ConflictSourceBase_T1Harbor.et` — small harbor
- `ConflictSourceBase_T2Harbor.et` — medium harbor
- `ConflictSourceBase_T3Harbor.et` — large harbor

Key difference: uses `SCR_CampaignSourceBaseComponent` (not `SCR_CampaignMilitaryBaseComponent`). These bases provide supply income and are captured like normal bases but do not have patrols by default.

---

## Ambient Patrol Spawning

Place `AmbientPatrolSpawnpoint_Base.et` (`{1E4C8AD00BBB16AA}`) or faction variants near each base. These spawn AI patrols. Group all instances in a `$grp GenericEntity` block in `AmbientPatrolSpawnpoints.layer`.

**Faction-specific prefabs** (preferred — no manual faction affiliation needed):

- `{9273AB931008C271}Prefabs/Systems/AmbientPatrol/AmbientPatrolSpawnpoint_FIA.et`
- `AmbientPatrolSpawnpoint_US.et` / `AmbientPatrolSpawnpoint_USSR.et`

`SCR_AmbientPatrolSpawnPointComponent` key properties:

- `m_bPickRandomGroupType 1` — random group type each spawn (standard)
- `m_iRespawnPeriod 600` — seconds between spawns (standard)
- `m_fAILimitThreshold 0.33` — light patrol (sparse AI), `0.66` — standard (spawn up to 66% of limit)
- `m_eGroupType FIRETEAM` — fixed group type (omit if using `m_bPickRandomGroupType`)
- `m_iSpawnDistanceOverride 400` — custom spawn-in distance (default ~400m)
- `m_iDespawnDistanceOverride 500` — custom despawn distance (default ~500m)

**Defender pattern** (with `SCR_DefendWaypoint` child): Add a defend waypoint as a child entity to restrict AI to a defence area:

```
$grp GenericEntity : "{9273AB931008C271}Prefabs/Systems/AmbientPatrol/AmbientPatrolSpawnpoint_FIA.et" {
 {
  components {
   SCR_AmbientPatrolSpawnPointComponent "{5CCEC6036BBF3EDD}" {
    m_bPickRandomGroupType 1
    m_iRespawnPeriod 600
   }
  }
  coords 6385 170 7109
  {
   SCR_DefendWaypoint : "{AAE8882E0DE0761A}Prefabs/AI/Waypoints/AIWaypoint_Defend_Hierarchy.et" {
    coords 125 -8 -37
    angleY 0
    CompletionRadius 33
   }
  }
 }
}
```

**Seeding variant:** `{0E66F798F84EEB58}Prefabs/Systems/AmbientPatrol/IRON_AmbientPatrolSpawnpoint_Base_Seeding.et` — only spawns during low-player seeding phase. Use `SCR_Iron_AmbientPatrolSpawnPointComponent_Seeding` with `m_iRespawnPeriod 90`.

Waypoint prefabs:

- `{FAD1D789EE291964}Prefabs/AI/Waypoints/AIWaypoint_Defend_Large.et` — default large patrol
- `{AAE8882E0DE0761A}Prefabs/AI/Waypoints/AIWaypoint_Defend_Hierarchy.et` — hierarchical defend
- `{06B1B14B6DE3C983}Prefabs/AI/Waypoints/AIWaypoint_Defend_ConflictBaseTeamPatrol.et` — conflict patrol
- `{2A81753527971941}Prefabs/AI/Waypoints/AIWaypoint_Defend_CP.et` — control point defence

**Auto-faction variant** (ConflictEscalation pattern): Override `SpawnPatrol()` to look up the nearest base faction at spawn time rather than using a fixed faction:

```c
modded class SCR_AmbientPatrolSpawnPointComponent
{
    override void SpawnPatrol()
    {
        SCR_CampaignMilitaryBaseComponent base =
            SCR_GameModeCampaign.GetInstance().GetBaseManager()
            .FindClosestBase(GetOwner().GetOrigin());
        // Update faction to match base owner
        Update(base.GetFaction());
        super.SpawnPatrol();
    }
}
```

**Spawn gating pattern** (LinearConflictPVE): Override `CanBeUsed()` to allow spawning only near active objectives:

```c
modded class SCR_AmbientPatrolSpawnPointComponent
{
    override bool CanBeUsed()
    {
        if (!m_RelatedBase) return super.CanBeUsed();
        LCP_GamemodeComponent comp = LCP_GamemodeComponent.GetInstance();
        if (!comp) return super.CanBeUsed();
        return comp.CanUseSpawnpoint(m_RelatedBase);
    }
}
```

---

## Ambient Vehicle Spawning

Ambient vehicles use separate layer files per faction (`FIA_Vehicles.layer`, `AUTO_Veh_Spawns_Airfield.layer`, etc.).

```
$grp GenericEntity : "{D4A604DD154470CD}Prefabs/Systems/AmbientVehicles/AmbientVehicleSpawnpoint_FIA.et" {
 {
  components {
   SCR_AmbientVehicleSpawnPointComponent "{5D5E85F932F777FA}" {
    m_iRespawnPeriod 600
    m_aExcludedEditableEntityLabels {
     53   // exclude heavy vehicles
    }
   }
  }
  coords 4407 7 10906
  angleY -119
 }
}
```

Civilian vehicle variant: `{0DDAFCA92FF4451C}Prefabs/Systems/AmbientVehicles/AmbientVehicleSpawnpoint_CIV.et`

`SCR_AmbientVehicleSpawnPointComponent` key properties:

- `m_iRespawnPeriod 600` — seconds between spawns
- `m_aIncludedEditableEntityLabels` — whitelist: `TRAIT_PASSENGERS_SMALL`, `TRAIT_PASSENGERS_LARGE`
- `m_aExcludedEditableEntityLabels` — blacklist: `VEHICLE_HELICOPTER`, `VEHICLE_AIRPLANE`, `53` (heavy)

Auto-faction variant: `{EB835D24922D2A23}Prefabs/Systems/AmbientVehicles/IRON_AmbientVehicleSpawnpoint_Base_Auto.et` — auto-detects faction from nearest base.

---

## Seeding Support

For servers that need AI during low-player seeding phase:

```
$grp GenericEntity : "{0E66F798F84EEB58}Prefabs/Systems/AmbientPatrol/IRON_AmbientPatrolSpawnpoint_Base_Seeding.et" {
 {
  components {
   SCR_Iron_AmbientPatrolSpawnPointComponent_Seeding "{6650F20A86B10681}" {
    m_iRespawnPeriod 90
   }
  }
  coords 10847 15 1546
  angles 0 81 0
  {
   SCR_DefendWaypoint : "{AAE8882E0DE0761A}..." {
    coords -72 21 257
    CompletionRadius 75
   }
  }
 }
}
```

Player spawn points for seeding (faction-labeled, only shown during seeding):

```
$grp SCR_CampaignSpawnPointGroup : "{E10B6FCE03AA6905}Prefabs/MP/Campaign/CampaignSpawnPointsGroup.et" {
 {
  coords 10403 38 1763
  m_sFaction "US"
  m_Info SCR_UIInfo "{...}" {
   Name "Seeding Zone #1"
  }
  m_bOnlyShowDuringSeeding 1
 }
}
```

Enable on game mode: `m_bServerSeedingEnabled 1` + `m_iServerSeedingThreshold 10` (player count below which seeding mode activates).

`IRON_SeedingRestrictionZoneEntity : "{801DADF0D6C316B9}PrefabsEditable/RestrictionZone/E_SeedingRestrictionZoneBase.et"` — restricts players to MOB area during seeding. Add as child to MOB base entity with `m_bAutoSizeToHQ 1`.

---

## Defender Spawner (Barracks AI)

`SCR_DefenderSpawnerComponent` (TCI: `TCI_DefaultDefenderSpawnerComponent`) — spawns AI defenders from buildings when base is contested.

Behavior:

- Auto-detects closest base via range
- State: `ENABLED` / `DISABLED` based on player proximity
- Respawn delay scales with global AI count
- Reinforce queue: processes respawn of eliminated group members
- Stuck detection: timeout management for units that don't move

Key flow:

1. Check AI world limits (`SCR_AIWorld.GetAILimit()`)
2. Check player proximity state
3. Handle stuck units
4. Activate/respawn despawned members
5. Reinforce existing groups
6. Process spawn queue
7. Move group to rally points

---

## Player Spawn Points

`SCR_SpawnPoint` (`{E7F4D5562F48DDE4}Prefabs/MP/Spawning/SpawnPoint_Base.et`) — set `m_sFaction`.

`SCR_CampaignSpawnPointGroup` — groups of spawn positions near a base (embedded as child entity in `ConflictBase_Base.et`):

- `m_sFaction` — faction key
- `m_bUseNearbySpawnPositions 1` — allows spawning nearby
- `m_fSpawnPositionUsageRange 150` — search radius

Faction-prefixed prefabs: `SpawnPoint_US.et`, `SpawnPoint_USSR.et`, `SpawnPoint_FIA.et`.

---

## Dynamic Objective System (LinearConflictPVE pattern)

For PvE scenarios that scale objectives with player count, use a `ScriptComponent` singleton managing attack/captured arrays:

```c
class LCP_GamemodeComponent : ScriptComponent
{
    protected ref array<SCR_MilitaryBaseComponent> m_aCurrentAttackObjectives = {};
    protected ref array<SCR_MilitaryBaseComponent> m_aCapturedObjectives = {};

    // Called on 10-second loop via CallLater
    void ComputeNextObjective()
    {
        // 1. Query active tasks from SCR_TaskSystem
        SCR_TaskSystem taskSys = SCR_TaskSystem.GetInstance();
        array<SCR_Task> tasks = {};
        taskSys.GetTasksByState(tasks,
            SCR_ETaskState.CREATED | SCR_ETaskState.ASSIGNED, factionKey);

        // 2. Check captures: if enemy base now friendly, move to captured
        foreach (SCR_MilitaryBaseComponent base : m_aCurrentAttackObjectives)
        {
            if (base.GetFaction() == playerFaction)
            {
                m_aCapturedObjectives.Insert(base);
                m_aCurrentAttackObjectives.RemoveItem(base);
            }
        }

        // 3. If no attack objectives left, start cooldown then pick new ones
        if (m_aCurrentAttackObjectives.IsEmpty() && !m_aCapturedObjectives.IsEmpty())
        {
            GetGame().GetCallqueue().CallLater(PickNewObjective,
                m_iNewTaskCooldownMs, false);
            return;
        }

        // 4. Scale objective count with player count
        int players = GetGame().GetPlayerManager().GetPlayerCount();
        if (players >= m_iMinPlayersForSecondObj
            || GetDistanceToNearest() < m_fAutoAddObjectiveDistance)
            TryAddObjective(); // add 2nd objective
        if (players >= m_iMinPlayersForThirdObj)
            TryAddObjective(); // add 3rd objective
    }

    bool CanUseSpawnpoint(SCR_MilitaryBaseComponent base)
    {
        if (m_aCurrentAttackObjectives.Contains(base)) return true;
        if (m_aCapturedObjectives.Contains(base)) return true;
        return false;
    }
}
```

**Config file** (`$profile:LinearConflictPVEConfig/LCPConfig.json`):

```json
{
  "version": "0.1",
  "autoAddObjectiveDistance": "500",
  "minPlayersForSecondObj": "25",
  "minPlayersForThirdObj": "50",
  "objectiveDistanceRadiusMax": "800"
}
```

**Progress save** (`$profile:LinearConflictPVEConfig/LCPProgress.json`):

```json
{
  "version": "0.1",
  "m_aObjs": [42, 17]
}
```

Where values are base callsigns (integers from `SCR_CampaignMilitaryBaseComponent.GetCallsign()`).

**Task management** — use `SCR_TaskSystem`:

```c
SCR_SeizeCampaignMilitaryBaseTaskEntity castTask =
    SCR_SeizeCampaignMilitaryBaseTaskEntity.Cast(task);
SCR_CampaignMilitaryBaseComponent base = castTask.GetMilitaryBase();
castTask.SetTaskState(SCR_ETaskState.COMPLETED);
m_TaskSystem.DeleteTask(castTask);
```

**Default cooldown:** 300,000 ms (5 min) between objective rotations. Override via `SCR_MissionHeader.GetNewTaskCooldown()`.

---

## Respawn Wave System (PvE)

For PvE AI groups that respawn after elimination:

```c
[Attribute("-1", desc: "Number of respawn waves. -1 = infinite, 0 = no respawn")]
protected int m_iRespawnWaves;

[Attribute("120", desc: "Seconds before next respawn")]
protected int m_iRespawnPeriod;

override void OnAgentRemoved(SCR_AIGroup group, AIAgent agent)
{
    super.OnAgentRemoved(group, agent);
    if (m_iRespawnWaves > -1)
        m_iRespawnWaves--;
    m_RespawnTimestamp = GetGame().GetWorld().GetServerTimestamp()
        .PlusSeconds(m_iRespawnPeriod);
}
```

---

## Rank / XP Persistence (cross-session)

Pattern from `ConflictPersistentRank`:

```c
class PersistentRank_Util
{
    static string GetDirectory(string identity)
    {
        // Hierarchical sharding: avoids large flat directories
        return "$profile:PersistentRank/"
            + identity.Substring(0, 2) + "/"
            + identity.Substring(2, 2) + "/";
    }

    static void SaveRank(int playerId, SCR_ECharacterRank rank)
    {
        string identity;
        BackendApi.GetPlayerIdentityId(playerId, identity);
        string dir = GetDirectory(identity);
        FileIO.MakeDirectory(dir);
        FileHandle file = FileIO.OpenFile(dir + identity, FileMode.WRITE);
        file.WriteLine(typename.EnumToString(SCR_ECharacterRank, rank));
        file.Close();
    }

    static bool LoadRank(int playerId, out SCR_ECharacterRank rank)
    {
        // ... read + typename.StringToEnum(SCR_ECharacterRank, data)
    }

    static void ApplyPlayerRank(int playerId, SCR_ECharacterRank rank)
    {
        int currentXP = xpComp.GetXP(playerId);
        int requiredXP = factionMgr.GetRequiredRankXP(rank);
        int xpGap = requiredXP - currentXP;
        if (xpGap > 0)
            xpComp.AwardXP(playerId, SCR_EXPRewards.UNDEFINED, 1, false, xpGap);
    }
}

// In modded SCR_GameModeCampaign:
override void OnPlayerAuditSuccess(int playerId)
{
    super.OnPlayerAuditSuccess(playerId);
    SCR_ECharacterRank rank;
    if (PersistentRank_Util.LoadRank(playerId, rank))
        GetGame().GetCallqueue().CallLater(
            PersistentRank_Util.ApplyPlayerRank, 5000, false, playerId, rank);
}
```

Integration: also hook `SCR_CharacterRankComponent.s_OnRankChanged` to call `SaveRank()` on every rank change.

---

## Spawn Validation (`CanBeUsed()` override pattern)

All production mods gate patrol/vehicle spawning via `CanBeUsed()`:

```c
modded class SCR_AmbientPatrolSpawnPointComponent
{
    // Cache to avoid repeated lookups
    protected SCR_CampaignMilitaryBaseComponent m_RelatedBase;
    protected bool m_bPostInitDone = false;

    override void EOnInit(IEntity owner)
    {
        super.EOnInit(owner);
        // Delayed init — base manager not ready at OnInit time
        GetGame().GetCallqueue().CallLater(DelayedInit, 500);
    }

    protected void DelayedInit()
    {
        m_RelatedBase = SCR_GameModeCampaign.GetInstance()
            .GetBaseManager().FindClosestBase(GetOwner().GetOrigin());
        m_bPostInitDone = true;
    }

    override bool CanBeUsed()
    {
        if (!m_bPostInitDone) return false;
        if (!m_RelatedBase)   return super.CanBeUsed();
        // custom validation — e.g. objective check, faction check
        return MySystem.GetInstance().CanSpawnAt(m_RelatedBase);
    }
}
```

**Critical:** Always delay the base lookup with `CallLater` — base manager is not initialized during `EOnInit`.

---

## Auto-Save / Auto-Load (PvE pattern)

ConflictPVERemixed auto-loads the latest save on match start:

```c
modded class SCR_GameModeCampaign
{
    override void OnGameModeStart()
    {
        super.OnGameModeStart();
        if (Replication.IsServer())
            GetGame().GetCallqueue().CallLater(LoadLatestSave, 3000);
    }

    protected void LoadLatestSave()
    {
        SCR_SaveGameManager saveMgr = SCR_SaveGameManager.GetInstance();
        array<string> saves = {};
        saveMgr.GetAvailableSaves(saves);
        if (!saves.IsEmpty())
            saveMgr.Load(saves[saves.Count() - 1]);
    }

    override void OnGameModeEnd(SCR_GameModeEndData data)
    {
        super.OnGameModeEnd(data);
        // Optionally clear latest save on game end
    }
}
```

---

## CHZones (Seize & Secure / CAH variant)

For CAH-within-Conflict (SeizeAMPSecure pattern), add `SCR_CaptureAndHoldArea` entities:

- `{6980800459376F27}Prefabs/MP/Modes/CaptureAndHold/Areas/CaptureAndHoldArea_Base.et`
- `CaptureAndHoldArea_Major.et` — primary objective
- `CaptureAndHoldArea_Minor.et` — secondary

Standard naming: `AreaA1.et`, `AreaA2.et`, `AreaB1.et` (map-specific, in `Prefabs/CHZones/[MapName]/`).

Ticket reward on capture — override `SCR_ScenarioFrameworkActionBase`:

```c
class SCR_Ironbeard_SF_Tickets : SCR_ScenarioFrameworkActionBase
{
    [Attribute("100", desc: "Tickets to award on activation")]
    protected int m_iTickets;

    override void Activate(IEntity entity)
    {
        super.Activate(entity);
        SCR_ScoringSystemComponent scoring =
            SCR_ScoringSystemComponent.Cast(
                GetGame().GetGameMode().FindComponent(SCR_ScoringSystemComponent));
        if (scoring)
            scoring.AddFactionObjective(GetFaction(), m_iTickets);
    }
}
```

---

## Game Mode Modding

### Adding Configurable Attributes

```c
// File: scripts/Game/GameMode/SCR_GameModeCampaign_modded.c
modded class SCR_GameModeCampaign : SCR_BaseGameMode
{
    [Attribute("0", UIWidgets.CheckBox, "Enable ambient AI battle system")]
    protected bool m_bEnableAmbientAIBattles;

    [Attribute("32", UIWidgets.Slider, "Max players before ambient AI disables", "1 128 1")]
    protected int m_iAmbientAIPlayerThreshold;

    [Attribute("600", UIWidgets.Slider, "Battle prep timer (seconds)", "0 1800 10")]
    protected float m_fBattlePrepTime;

    [Attribute("0", UIWidgets.CheckBox, "Distribute harbor supplies evenly")]
    protected bool m_bSupplyHarborDistributionEnabled;

    [Attribute("250", UIWidgets.EditBox, "Supply amount per harbor interval")]
    protected int m_iSupplyHarborDistributionAmount;

    [Attribute("0", UIWidgets.CheckBox, "Enable server seeding mode")]
    protected bool m_bServerSeedingEnabled;

    [Attribute("0", UIWidgets.EditBox, "Players needed to exit seeding")]
    protected int m_iServerSeedingThreshold;
}
```

### Overriding Spawn Validation

```c
modded class SCR_GameModeCampaign
{
    override bool CanPlayerSpawn_S(int playerId)
    {
        if (!super.CanPlayerSpawn_S(playerId)) return false;

        // Custom check: e.g. minimum rank
        SCR_ECharacterRank rank = GetPlayerRank(playerId);
        if (rank < SCR_ECharacterRank.PRIVATE) return false;

        // Check supplies at selected base
        SCR_CampaignMilitaryBaseComponent base = GetSelectedBase(playerId);
        if (base && base.GetSupplies() <= 0) return false;

        return true;
    }
}
```

### Checking Radio Coverage in Script

```c
SCR_ERadioCoverageStatus coverage =
    base.IsHQRadioTrafficPossible(playerFaction);

if (coverage == SCR_ERadioCoverageStatus.NONE)
    return false; // No coverage — can't spawn here
```

---

## GameSystem Singletons

For world-level systems not tied to an entity:

```c
class MySystemManager : GameSystem
{
    override static void InitInfo(WorldSystemInfo outInfo)
    {
        outInfo.SetAbstract(false)
              .SetLocation(ESystemLocation.Both)
              .AddPoint(ESystemPoint.FixedFrame);
    }

    static MySystemManager GetInstance()
    {
        return MySystemManager.Cast(
            GetGame().GetWorld().FindSystem(MySystemManager));
    }
}
```

Register in `Configs/Systems/ChimeraSystemsConfig.conf`:

```
Systems {
 MySystemManager
}
```

---

## JSON Save/Load Pattern

Standard approach for all mods:

```c
// Struct definition
class LCPProgressStruct
{
    string version;
    ref array<int> m_aObjs = {};
}

// Save
void SaveProgress()
{
    SCR_JsonSaveContext ctx = new SCR_JsonSaveContext();
    ctx.WriteValue("", m_Progress);
    ctx.SaveToFile("$profile:MyMod/progress.json");
}

// Load
bool LoadProgress()
{
    SCR_JsonLoadContext ctx = new SCR_JsonLoadContext();
    if (!ctx.LoadFromFile("$profile:MyMod/progress.json"))
        return false;
    ctx.ReadValue("", m_Progress);
    return true;
}
```

**File paths:** Use `$profile:` prefix. Create subdirs with `FileIO.MakeDirectory()`.
**Saving on rank change** (persistent rank): hook `SCR_CharacterRankComponent.s_OnRankChanged`.
**Do NOT save on every frame** — use event hooks or periodic `CallLater` (e.g. every 60s).

---

## Key API Methods

| Method                                          | Class                               | Purpose                        |
| ----------------------------------------------- | ----------------------------------- | ------------------------------ |
| `GetBaseManager()`                              | `SCR_GameModeCampaign`              | Get base manager singleton     |
| `FindClosestBase(vector)`                       | `SCR_CampaignMilitaryBaseManager`   | Find nearest base to position  |
| `FindClosestBaseToBase(base, faction)`          | `SCR_CampaignMilitaryBaseManager`   | Find nearest enemy base        |
| `GetCallsign()`                                 | `SCR_CampaignMilitaryBaseComponent` | Int identifier for save/load   |
| `IsHQ()` / `CanBeHQ()`                          | `SCR_CampaignMilitaryBaseComponent` | HQ status checks               |
| `GetFaction()`                                  | `SCR_CampaignMilitaryBaseComponent` | Current owning faction         |
| `GetSupplies()`                                 | `SCR_CampaignSuppliesComponent`     | Current supply count           |
| `IsHQRadioTrafficPossible(faction)`             | `SCR_CampaignMilitaryBaseComponent` | Radio coverage check           |
| `GetTasksByState(tasks, state, factionKey)`     | `SCR_TaskSystem`                    | Query active tasks             |
| `DeleteTask(task)`                              | `SCR_TaskSystem`                    | Remove a task                  |
| `AwardXP(playerId, reward, mult, flag, amount)` | `SCR_XPHandlerComponent`            | Grant XP to player             |
| `GetPlayerIdentityId(playerId, out id)`         | `BackendApi`                        | Get persistent player identity |

---

## Common Pitfalls

**Radio coverage:** Player spawn points and map markers only appear within radio range of a friendly MOB or relay. If players can't spawn at a base, check that a friendly MOB is within ~1000m radius or add `ConflictRelayRadio` entities.

**AI world limits:** Always check AI count before spawning patrols/defenders (`SCR_AIWorld.GetAILimit()`). Exceeding the limit causes spawning to silently fail.

**Spawn supply validation:** Conflict checks base supplies before allowing player spawn. If a base has 0 supplies, players cannot spawn there. MOBs need `m_iSupplies 3000`; regular bases need `m_iRegularSuppliesIncomeBase`.

**Base name mismatch:** `m_aCampaignCustomBaseList.m_sBaseName` must exactly match `SCR_CampaignMilitaryBaseComponent.m_sBaseName` — case-sensitive. Mismatches silently hide the base.

**World file must be SubScene:** Workbench will reject a Conflict world that isn't a SubScene of a valid vanilla world. Never create a standalone `.ent`.

**Y coordinate = 0:** Use Y=0 in generated world files — Workbench snaps to terrain on open. Hardcoded Y values break on uneven terrain.

**Faction key case:** `"US"`, `"USSR"`, `"FIA"` are uppercase in all API calls and component properties.

**Delayed base lookup:** In `EOnInit`, the base manager is not yet ready. Always delay base lookups with `CallLater(DelayedInit, 500)` or later.

**`modded class` not `class`:** Always use `modded class SCR_GameModeCampaign` to extend the existing game mode entity. A plain `class MySCR_GameModeCampaign : SCR_GameModeCampaign` creates a new class that nothing uses.

**Counter attack spawn validation:** CPR's randomizer loops up to 30 iterations checking terrain steepness, water, player proximity, and road surfaces. If no valid position is found in 30 tries, the spawn is skipped silently. Place patrol spawnpoints in open terrain areas.

**Artillery ballistics:** Artillery patrol spawnpoints require valid aim angle (0.785–1.48 rad, ~45°–85°) and terrain line-of-sight. Place at elevated positions with clear sightlines to target areas.
