# Conflict Seeding System

Seeding mode keeps a Conflict server alive during low-population periods by restricting players to the MOB area and spawning AI patrols. Once enough players connect, the restriction lifts permanently and normal gameplay begins.

---

## How It Works

```
Server starts → m_bServerSeedingEnabled = true → seeding active
    Players restricted to MOB zone (IRON_SeedingRestrictionZoneEntity)
    Seeding spawn points visible (m_bOnlyShowDuringSeeding 1)
    Seeding AI patrols active (IRON_AmbientPatrolSpawnpoint_Base_Seeding.et)

Player count reaches m_iServerSeedingThreshold
    → seeding = false (PERMANENT — never re-activates)
    Restriction zones deactivate
    Seeding spawn points hide
    Seeding AI patrols stop spawning
    Normal game begins
```

**One-way transition:** `m_bStateTriggered` flag locks permanently once threshold is crossed. Seeding cannot restart mid-session even if players disconnect.

---

## Gamemode Attributes

Add to `modded class SCR_GameModeCampaign`:

```c
[Attribute("0", UIWidgets.CheckBox, "Enable server seeding mode", category: "Seeding")]
protected bool m_bServerSeedingEnabled;

[Attribute("0", UIWidgets.EditBox, "Players to exit seeding (0=disabled)", "0 128 1", category: "Seeding")]
protected int m_iServerSeedingThreshold;

bool GetIsServerSeedingEnabled() { return m_bServerSeedingEnabled; }
int GetServerPlayerThreshold() { return m_iServerSeedingThreshold; }
```

---

## Seeding Manager (`Iron_SeedingSystemManager`)

Custom `GameSystem` class that tracks state. Query it from any script:

```c
// Get instance
Iron_SeedingSystemManager mgr = Iron_SeedingSystemManager.GetInstance();

// Check current state
bool isSeeding = mgr.GetSeedingState();

// Subscribe to state changes
mgr.GetOnSeedingStateInvoker().Insert(OnSeedingStateChanged);

void OnSeedingStateChanged(bool seedingActive)
{
    if (!seedingActive)
        Print("Seeding ended — full game begins");
}
```

Manager internals:

- `m_fTickRate = 30` — update every 30 frames
- `OnPlayerConnectionChange(int playerId)` — re-checks threshold on each connect/disconnect
- `UpdateSeedingState()` — broadcasts via RPC when state changes
- `SeedingBroadcastMessage(string header, int duration)` — message all players

---

## Restriction Zone (`IRON_SeedingRestrictionZoneEntity`)

Confines players to the MOB area during seeding. Place as a child of the MOB base entity.

**Prefab:** `{801DADF0D6C316B9}PrefabsEditable/RestrictionZone/E_SeedingRestrictionZoneBase.et`

```
// In Bases.layer, inside the MOB entity block:
MOB_US {
 ...
 {
  IRON_SeedingRestrictionZoneEntity : "{801DADF0D6C316B9}PrefabsEditable/RestrictionZone/E_SeedingRestrictionZoneBase.et" {
   m_bAutoSizeToHQ 1         // dynamically size zone based on HQ distance
   m_iDistanceToHQ 2000      // zone stops 2000m from enemy HQ
   coords 0 0 0              // relative to parent MOB
  }
 }
}
```

### Auto-size mode (`m_bAutoSizeToHQ 1`)

When enabled, the zone radius is calculated dynamically:

- `m_fAutoZoneRadius = Clamp(HQDistance - m_iDistanceToHQ, baseRadius, HQDistance)`
- `m_fAutoWarnRadius = autoZoneRadius - 300` — warn players before teleport
- `m_fAutoZoneTeleportedRadius = autoZoneRadius + 300` — teleport threshold

Properties replicated: `m_fDistanceBetweenHQ`, `m_fAutoZoneRadius`, `m_fAutoWarnRadius`, `m_fAutoZoneTeleportedRadius`

### Manual mode (`m_bAutoSizeToHQ 0`)

Set `m_bIsDetachedFromHQ 1` and configure the base `SCR_PlayersRestrictionZoneManagerComponent` radius manually.

---

## Seeding Spawn Points

Player spawn points only visible during seeding. Use `SCR_CampaignSpawnPointGroup`:

```
// In SeedingSpawns.layer or SeedingPvpZone.layer:
$grp SCR_CampaignSpawnPointGroup : "{E10B6FCE03AA6905}Prefabs/MP/Campaign/CampaignSpawnPointsGroup.et" {
 {
  coords 10403 38 1763
  m_sFaction "US"
  m_bOnlyShowDuringSeeding 1
  m_Info SCR_UIInfo {
   Name "Seeding Zone #1"
  }
 }
 {
  coords 11200 40 2100
  m_sFaction "USSR"
  m_bOnlyShowDuringSeeding 1
  m_Info SCR_UIInfo {
   Name "Seeding Zone #1"
  }
 }
}
```

---

## Seeding AI Patrols

AI patrols that only spawn during seeding. Use the dedicated seeding prefab:

**Prefab:** `{0E66F798F84EEB58}Prefabs/Systems/AmbientPatrol/IRON_AmbientPatrolSpawnpoint_Base_Seeding.et`
**Component:** `SCR_Iron_AmbientPatrolSpawnPointComponent_Seeding`

```
// In AmbientPatrols_SEEDING.layer or SeedingPvpZone.layer:
$grp GenericEntity : "{0E66F798F84EEB58}Prefabs/Systems/AmbientPatrol/IRON_AmbientPatrolSpawnpoint_Base_Seeding.et" {
 {
  components {
   SCR_Iron_AmbientPatrolSpawnPointComponent_Seeding "{6650F20A86B10681}" {
    m_bRespawnOnlyDuringSeeding 1   // patrols stop when seeding ends
    m_iRespawnPeriod 90             // fast respawn (90s vs 600s normal)
   }
  }
  coords 10847 15 1546
  angles 0 81 0
  {
   SCR_DefendWaypoint : "{AAE8882E0DE0761A}Prefabs/AI/Waypoints/AIWaypoint_Defend_Hierarchy.et" {
    coords -72 21 257
    CompletionRadius 75
   }
  }
 }
}
```

`m_bRespawnOnlyDuringSeeding 1` — `SpawnPatrol()` is a no-op when seeding state is false.

---

## SeedingPvpZone.layer Pattern

One common layer consolidates all seeding content:

```
Layer: SeedingPvpZone.layer
├── $grp SCR_CaptureAndHoldArea (seeding PvP zone boundaries)
├── $grp SCR_CampaignSpawnPointGroup (seeding-only spawn points, m_bOnlyShowDuringSeeding 1)
└── $grp IRON_AmbientPatrolSpawnpoint_Base_Seeding (seeding AI patrols)
```

Alternatively split into:

- `SeedingSpawns.layer` — spawn points only
- `AmbientPatrols_SEEDING.layer` — AI patrols only

---

## Complete Seeding Setup Checklist

1. **Gamemode attributes** — add `m_bServerSeedingEnabled`, `m_iServerSeedingThreshold` via `modded class SCR_GameModeCampaign`
2. **Seeding manager** — implement `Iron_SeedingSystemManager : GameSystem` (or use ConflictEscalation's version)
3. **Restriction zones** — add `IRON_SeedingRestrictionZoneEntity` as child of each MOB base entity
4. **Seeding spawn points** — `SCR_CampaignSpawnPointGroup` with `m_bOnlyShowDuringSeeding 1` in `SeedingPvpZone.layer`
5. **Seeding AI** — `IRON_AmbientPatrolSpawnpoint_Base_Seeding.et` in `AmbientPatrols_SEEDING.layer` with fast `m_iRespawnPeriod 90`
6. **Default.layer** — set `m_bServerSeedingEnabled 1` and `m_iServerSeedingThreshold X` on game mode entity

---

## Key Values from Production Mods

| Setting                             | Typical value     | Notes                              |
| ----------------------------------- | ----------------- | ---------------------------------- |
| `m_iServerSeedingThreshold`         | 8–16              | Players needed before seeding ends |
| `m_iDistanceToHQ`                   | 2000              | Zone stops 2km from enemy HQ       |
| `m_iRespawnPeriod` (seeding patrol) | 90                | Fast respawn to keep AI density up |
| `m_iRespawnPeriod` (normal patrol)  | 600               | Standard respawn                   |
| Spawn point name                    | "Seeding Zone #1" | Shown in spawn selection UI        |
