# Conflict Supply System

The supply system is the economic backbone of all Conflict scenarios. Supplies fund building, spawning, and base establishment. Understanding the flow is essential for designing balanced scenarios.

---

## Architecture

The modern supply system uses `SCR_ResourceComponent` internally. The older `SCR_CampaignSuppliesComponent` still exists on vehicles and depots but is marked `[Obsolete]` — do not use it for new logic. Query supply values through `SCR_CampaignMilitaryBaseComponent` and the gamemode getters.

---

## Supply Income Flow

```
Harbor / Airfield (source base)
    → every 300s: +2500 supplies distributed to connected friendly bases

HQ / MOB
    → every 5s: +40 supplies (m_iRegularSuppliesIncome)
    → each connected relay radio: +4 extra/tick

Regular contested base
    → every 5s: +4 supplies (m_iRegularSuppliesIncomeBase)
    → each connected relay radio: +4 extra/tick

Quick replenish (when below threshold)
    → income × 2.0 multiplier (m_fQuickSuppliesReplenishMultiplier)
    → threshold: 200 supplies (m_iQuickSuppliesReplenishThreshold)

Auto-replenish ceiling: 1000 supplies (m_iSuppliesReplenishThreshold)
    → income only flows up to this cap
```

---

## Gamemode Supply Attributes (`SCR_GameModeCampaign`)

### Income

| Attribute                          | Default | Description                                           |
| ---------------------------------- | ------- | ----------------------------------------------------- |
| `m_iRegularSuppliesIncome`         | `40`    | HQ/MOB income per tick                                |
| `m_iRegularSuppliesIncomeBase`     | `4`     | Regular base income per tick                          |
| `m_iRegularSuppliesIncomeExtra`    | `4`     | Bonus per connected relay radio per tick              |
| `m_iRegularSuppliesIncomeSource`   | `2500`  | Source base (harbor/airfield) income per distribution |
| `m_iSuppliesArrivalInterval`       | `5`     | Seconds between base income ticks                     |
| `m_iSuppliesArrivalIntervalSource` | `300`   | Seconds between source base distributions             |

### Thresholds

| Attribute                             | Default | Description                                      |
| ------------------------------------- | ------- | ------------------------------------------------ |
| `m_iSuppliesReplenishThreshold`       | `1000`  | Auto-replenish ceiling — income stops above this |
| `m_iQuickSuppliesReplenishThreshold`  | `200`   | Below this: income ×2.0                          |
| `m_fQuickSuppliesReplenishMultiplier` | `2.0`   | Multiplier when below quick threshold            |

### Starting Supplies

| Attribute                     | Default | Description                            |
| ----------------------------- | ------- | -------------------------------------- |
| `m_iHQStartingSupplies`       | `600`   | Initial supplies for HQ/MOB bases      |
| `m_iMinStartingSupplies`      | `100`   | Randomized start min for regular bases |
| `m_iMaxStartingSupplies`      | `500`   | Randomized start max for regular bases |
| `m_iStartingSuppliesInterval` | `25`    | Randomization step size                |
| `m_bRandomizeSupplies`        | `true`  | Toggle randomized starting supplies    |

**Note:** Production mods typically set `m_iSupplies 500` on MOB entities (not 3000). The `3000` max cap is just the ceiling, not the starting amount.

### Map Display

| Attribute                     | Default | Description                               |
| ----------------------------- | ------- | ----------------------------------------- |
| `m_iSupplyDepotIconThreshold` | `1200`  | Distance to show standalone depots on map |

---

## Per-Base Supply Overrides (`SCR_CampaignMilitaryBaseComponent`)

These override the gamemode defaults for individual bases:

| Property                            | Default  | Description                                            |
| ----------------------------------- | -------- | ------------------------------------------------------ |
| `m_iRegularSuppliesIncomeBase`      | `-1`     | Per-base income override (-1 = use gamemode value)     |
| `m_iSuppliesArrivalInterval`        | `-1`     | Per-base tick interval override (-1 = use gamemode)    |
| `m_fSupplyLimit`                    | `0.2`    | Resupply threshold as fraction of max capacity (0–0.9) |
| `m_fReservedSupplyAmount`           | `0.5`    | Fraction kept in reserve for storage (0.1–0.9)         |
| `m_eSupplyRequestExecutionPriority` | `MEDIUM` | Priority when multiple resupply tasks compete          |

---

## Rank-Based Supply Allocation

Players receive a personal supply budget based on rank (from `CampaignMilitarySupplyAllocationConfig.conf`). Replenishment interval: 300s.

| Rank       | Allocation |
| ---------- | ---------- |
| Renegade   | 0          |
| Private    | 65         |
| Corporal   | 100        |
| Sergeant   | 135        |
| Lieutenant | 185        |
| Captain    | 235        |
| Major      | 300        |

Mod override (SeizeAMPSecure values):

| Rank       | Allocation |
| ---------- | ---------- |
| Private    | 50         |
| Corporal   | 75         |
| Sergeant   | 100        |
| Lieutenant | 150        |
| Captain    | 250        |
| Major      | 400        |

---

## Supply Vehicle System (`SCR_CampaignSuppliesComponent`)

Supply trucks and helicopters carry supplies between depots and bases.

Key properties (on vehicle entity):

- `m_iSupplies` (RplProp) — current supply amount on vehicle
- `m_iSuppliesMax` (RplProp) — vehicle capacity
- `m_fOperationalRadius` — load/unload radius (default 25m)
- `m_bIsStandaloneDepot` — marks standalone supply depot

Key methods:

```c
GetSupplies() → int
GetSuppliesMax() → int
AddSupplies(int supplies, bool replicate)
SetLastLoadedAt(SCR_CampaignMilitaryBaseComponent base)
SetLastUnloadedAt(SCR_CampaignMilitaryBaseComponent base)
AwardXP() → bool  // should XP be awarded for this unload?
static GetSuppliesComponent(IEntity ent) → searches entity + all slots
```

`SUPPLY_TRUCK_UNLOAD_RADIUS = 25m` — max distance from depot to load/unload.

XP: `m_fSupplyOffloadAssistanceReward 0.5` — XP multiplier for unloading supplies you didn't load yourself.

---

## Supply Sources (Harbors & Airfields)

Source bases use `SCR_CampaignSourceBaseComponent` (not `SCR_CampaignMilitaryBaseComponent`). They distribute `m_iRegularSuppliesIncomeSource` every `m_iSuppliesArrivalIntervalSource` seconds to connected friendly bases.

```
$grp GenericEntity : "{0226331FB6A8249A}Prefabs/Systems/MilitaryBase/ConflictSourceBase_T3Harbor.et" {
 HarborNorth {
  components {
   SCR_CampaignSourceBaseComponent "{621EB97024DABD3C}" {
    m_bExcludeFromRandomization 1
   }
  }
  coords 5803 2 3533
 }
}
```

Prefab tiers:

- `{8BEE4B0606893CDF}` `ConflictSourceBase_T1Harbor.et` — small
- `{0226331FB6A8249A}` `ConflictSourceBase_T3Harbor.et` — large
- `{1739B43A3702BB84}` `ConflictSourceBase_Airfield.et` — airfield

---

## Supply Script API

### Querying base supplies

```c
SCR_CampaignMilitaryBaseComponent base = ...;

// Get current supply scarcity (positive = needs resupply)
float scarcity = base.GetScarcityLevel();

// Is resupply needed?
bool needed = base.IsResupplyNeeded();

// Events
base.GetOnSuppliesArrivalInvoker(); // ScriptInvokerVoid — fires each income tick
base.GetOnSupplyLimitChanged();
base.GetOnReservedSupplyAmountChanged();
```

### Querying gamemode supply settings

```c
SCR_GameModeCampaign gm = SCR_GameModeCampaign.Cast(GetGame().GetGameMode());
int hqIncome  = gm.GetRegularSuppliesIncome();        // 40 default
int baseIncome = gm.GetRegularSuppliesIncomeBase();    // 4 default
int relayBonus = gm.GetRegularSuppliesIncomeExtra();   // 4 per relay
int sourceIncome = gm.GetRegularSuppliesIncomeSource(); // 2500 default
int replenishCap = gm.GetSuppliesReplenishThreshold();  // 1000 default
```

---

## Supply Distribution Override (ConflictEscalation pattern)

Even distribution of harbor supplies across owned bases:

```c
modded class SCR_GameModeCampaign
{
    [Attribute("0", UIWidgets.CheckBox, "Distribute harbor supplies evenly")]
    protected bool m_bSupplyHarborDistributionEnabled;

    [Attribute("50", UIWidgets.EditBox, "Supplies per harbor distribution tick")]
    protected int m_iSupplyHarborDistributionAmount;

    bool GetSupplyHarborDistributionEnabled() { return m_bSupplyHarborDistributionEnabled; }
    int GetSupplyHarborDistributionAmount() { return m_iSupplyHarborDistributionAmount; }
}
```

---

## Scenario Design Guidelines

| Base type     | Starting supplies      | Max cap | Income/tick | Notes                                      |
| ------------- | ---------------------- | ------- | ----------- | ------------------------------------------ |
| MOB / HQ      | 600 (gamemode default) | 3000    | 40          | Set `m_iSupplies 500` in layer for balance |
| Regular base  | 100–500 (randomized)   | ~1000   | 4           |                                            |
| Major base    | 100–500                | ~1000   | 4           | Often also a supply hub                    |
| Harbor (T3)   | —                      | —       | 2500/300s   | Source only, no income decay               |
| Control point | 100–500                | ~1000   | 4           | Lightweight, no supply hub                 |

**Balance tips from production mods:**

- MOBs at 500 starting (not 3000) — forces players to manage supply chains from day 1
- Quick replenish threshold (200) prevents bases from going completely dry during heavy combat
- Relay radios (+4/tick each) reward radio network expansion
- Source bases make harbors strategically important — place them at map extremes
