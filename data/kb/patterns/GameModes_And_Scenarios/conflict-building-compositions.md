# Conflict Building & Composition System

Players can build fortifications, relay radios, FOBs, and support structures at bases using supplies. This system uses a budget-based placement model with a master provider pattern.

---

## Architecture

```
SCR_CampaignBuildingProviderComponent  (on a base entity or vehicle)
    ↓ checks budgets (CAMPAIGN=supplies, PROPS, AI)
    ↓ reads SCR_ResourceComponent for supply balance
SCR_CampaignBuildingCompositionComponent  (on each placed composition)
    ↓ tracks cost, builder, provider, lock state
SCR_CompositionSlotManagerComponent  (on GameMode)
    ↓ manages slot occupancy
```

---

## Building Provider (`SCR_CampaignBuildingProviderComponent`)

Attached to the entity that offers the build interface (usually the main base entity or a service truck).

### Key properties

| Property                          | Default | Description                                      |
| --------------------------------- | ------- | ------------------------------------------------ |
| `m_fBuildingRadius`               | `50`    | Radius in which compositions can be placed       |
| `m_iRank`                         | `1`     | Minimum rank to use (1 = Private)                |
| `m_bIsMasterProvider`             | —       | HQ entity: owns the shared supply budget         |
| `m_bUseMasterProvider`            | —       | Defer to master provider for budget              |
| `m_bUseAllAvailableProviders`     | —       | Aggregate all nearby providers                   |
| `m_bRegisterAtBase`               | —       | Auto-register with nearest base on spawn         |
| `m_bObstructViewWhenEnemyInRange` | —       | Block building UI when enemy detected            |
| `m_bAnyFactionCanUse`             | —       | Allow all factions to build (e.g. neutral zones) |

### Budget system

Three independent budgets are evaluated before any composition can be placed:

| Budget type | `EEditableEntityBudget` | Description                    |
| ----------- | ----------------------- | ------------------------------ |
| `CAMPAIGN`  | Supplies budget         | Deducted from base supply pool |
| `PROPS`     | Static object budget    | World object count limit       |
| `AI`        | AI entity budget        | Limits total spawned AI        |

Check order: `IsThereEnoughBudgetToSpawn(array<ref SCR_EntityBudgetValue> budgetCosts)` — all three must pass.

Master provider pattern: Only the HQ/MOB base is typically the master provider. All other providers at the same base use `m_bUseMasterProvider = true` to draw from the same supply pool.

```c
// Check if there are enough supplies before building
bool ok = provider.IsThereEnoughSupplies(
    availableSupplies,   // current supplies at base
    supplyCost,          // cost of this composition
    accumulatedCost      // supplies already committed this tick
);
```

---

## Placed Composition (`SCR_CampaignBuildingCompositionComponent`)

Attached to every placed/built entity.

### Key properties

| Property                            | Description                                            |
| ----------------------------------- | ------------------------------------------------------ |
| `m_bCompositionIsSpawned` (RplProp) | True when fully spawned and usable                     |
| `m_iBuilderId`                      | Player ID of builder (0 = INVALID_PLAYER_ID)           |
| `m_iCost`                           | Supply cost (read from EditableEntity budget at spawn) |
| `m_iPrefabId`                       | Composition type ID for building mode                  |
| `m_bInteractionLock` (RplSaved)     | Prevents move/delete in Free Roam mode                 |
| `m_ProviderEntity`                  | The base/provider this composition belongs to          |

### Key methods

```c
IsCompositionSpawned() → bool
GetCompositionCost() → int          // supply cost
GetBuilderId() → int                // player who built it
SetBuilderId(int id)
IsInteractionLocked() → bool
SetInteractionLock(bool lockState)  // broadcast via RPC
SetProviderEntity(IEntity base)
RemoveProviderEntity()
GetOnCompositionSpawned() → ScriptInvokerBool
GetOnBuilderSet() → ScriptInvokerVoid
```

### Service state during construction

While building: sets the service point to `UNDER_CONSTRUCTION` state. UI shows progress indicator. When `m_bCompositionIsSpawned` flips to true, service becomes active.

---

## Buildable Compositions

Compositions are categorized by slot type. Costs are in supplies (CAMPAIGN budget).

### Slot types

| Slot             | Size            | Typical compositions             |
| ---------------- | --------------- | -------------------------------- |
| `SlotFlatSmall`  | Small flat      | Sandbags, hedgehogs, barbed tape |
| `SlotFlatMedium` | Medium flat     | MG nest, bunker small, camo net  |
| `SlotFlatLarge`  | Large flat      | Bunker large, living area        |
| `SlotRoadSmall`  | Small roadside  | Roadblock, barricade small       |
| `SlotRoadMedium` | Medium roadside | Checkpoint, barricade medium     |
| `SlotRoadLarge`  | Large roadside  | Gate, large checkpoint           |

### Common compositions and costs

| Composition         | Supply cost | Notes                      |
| ------------------- | ----------- | -------------------------- |
| Barbed Tape         | 20          | Perimeter obstacle         |
| Czech Hedgehog      | 20          | Anti-vehicle obstacle      |
| Dragonsteeth        | 20          | Anti-vehicle               |
| Sandbag Round       | 20          | Infantry cover             |
| Sandbag Long        | 30          | Infantry cover             |
| Sandbag Solid       | 30          | Thicker cover              |
| Camo Net Small      | 30          | Vehicle concealment        |
| Camo Net Medium     | 40          | Larger concealment         |
| Machine Gun Nest    | varies      | Defensive position         |
| Bunker Small        | varies      | Infantry shelter           |
| Vehicle Maintenance | 100         | Service point for vehicles |
| Barricade Medium    | 100         | Road blocking              |
| Field Hospital      | varies      | Medical service            |
| Ammo Storage        | varies      | Ammo resupply              |
| Fuel Storage        | varies      | Fuel resupply              |

---

## Relay Radio (`ConflictRelayRadio.et`)

The relay radio is the most strategically important buildable. It extends radio coverage and grants +4 supplies/tick to connected bases.

**Prefab GUID:** `{522DCD528AE27052}Prefabs/Systems/MilitaryBase/ConflictRelayRadio.et`

### Structure

```
GenericEntity ID "5C727AD73024FB47"
 SCR_CampaignMilitaryBaseComponent {
  m_iRadius = 10
  m_bShowNotifications = 0
  m_sBaseName = "#AR-MapIcon_Tower"
  m_eType = RELAY
 }
 SCR_CoverageRadioComponent {
  Turned on = 0           // disabled at spawn — requires reconfiguration
  Transceivers {
   RelayTransceiver {
    Transmitting Range = 3000    // 3km coverage radius
    Frequency resolution = 1
   }
  }
 }
 SCR_FactionAffiliationComponent { faction affiliation = "FIA" }
```

### Reconfiguration

The relay radio is **disabled at spawn** (`Turned on = 0`). A player must perform a 10-second `CampaignReconfigureRelay` action to activate it.

```
Child: RadioStation_R123M_01.et
 SCR_CampaignReconfigureRelayUserAction { Duration = 10s }
```

### Relay radio vs pre-placed radio

- `ConflictRelayRadio.et` — player-buildable, starts disabled, 3000m range
- Pre-placed relay in `Bases.layer` — permanent, enabled, typically 1470m range
- Pre-placed relay tower positions: use `SCR_CampaignRelayAlternativeSpot` entities — randomized placement candidates

---

## Composition Slot Manager (`SCR_CompositionSlotManagerComponent`)

Attached to GameMode entity. Tracks which composition slots are occupied.

```c
// Get instance
SCR_CompositionSlotManagerComponent mgr =
    SCR_CompositionSlotManagerComponent.GetInstance();

// Check if slot is occupied
bool occupied = mgr.IsOccupied(slotEntity);

// Get what's in a slot
IEntity occupant = mgr.GetOccupant(slotEntity);

// Set occupant (server-side, broadcasts)
mgr.SetOccupant(slotEntity, compositionEntity);

// Find slot by position
mgr.SetOccupant(worldPos, compositionEntity);

// Events
mgr.GetOnEntityChanged(); // fires when any slot changes
```

---

## Budget Validation Flow

When a player tries to place a composition:

1. `IsThereEnoughBudgetToSpawn(budgetCosts)` checks all budget types
2. For CAMPAIGN budget: `IsThereEnoughSupplies(available, cost, accumulated)`
3. For PROPS budget: checks static object count against world limit
4. For AI budget: checks spawned AI count against `SCR_AIWorld.GetAILimit()`
5. All must pass — if any fails, placement is blocked with UI feedback

Deferred budget changes (avoid double-spending during same frame):

```c
provider.AccumulateBudgetChange(EEditableEntityBudget.CAMPAIGN, cost);
int pending = provider.GetAccumulatedBudgetChanges(EEditableEntityBudget.CAMPAIGN);
provider.ClearAccumulatedBudgetChanges();
```

---

## Scenario Design Notes

- **Relay radios are win conditions** — a faction that builds relay chains extends spawn coverage and gains supply income. Design maps with radio range gaps to incentivize building.
- **Fortification slots** define what can be built at a base. Production mods place `SlotFlat*` and `SlotRoad*` entities inside `BaseLogic.layer` compositions.
- **Master provider at MOB** — always set the MOB as `m_bIsMasterProvider`. All other service providers at the same base should use `m_bUseMasterProvider`.
- **Building radius** — default 50m. Increase for large airfield/harbour bases.
- **Rank gate** — `m_iRank 3` (Sergeant) is common for expensive compositions. Prevents new players from wasting supplies.
