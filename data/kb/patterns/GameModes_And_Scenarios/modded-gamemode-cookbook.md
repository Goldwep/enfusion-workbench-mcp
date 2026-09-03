# Modded Game Mode Cookbook

Patterns for extending `SCR_GameModeCampaign` in Conflict multiplayer mods. All patterns use `modded class` — never a plain `class` inheritance.

---

## Basic Structure

```c
// File: scripts/Game/GameMode/SCR_GameModeCampaign_modded.c
modded class SCR_GameModeCampaign
{
    // New attributes exposed in Workbench
    [Attribute("0", UIWidgets.CheckBox, "Enable my feature", category: "My Mod")]
    protected bool m_bMyFeatureEnabled;

    [Attribute("300", UIWidgets.EditBox, "Feature duration (s)", "0 3600 1", category: "My Mod")]
    protected int m_iMyFeatureDuration;

    // Getter (always add a getter — other systems call it)
    bool IsMyFeatureEnabled() { return m_bMyFeatureEnabled; }
    int GetMyFeatureDuration() { return m_iMyFeatureDuration; }

    // Event overrides
    override void OnGameModeStart()
    {
        super.OnGameModeStart();
        if (!Replication.IsServer()) return;
        if (m_bMyFeatureEnabled)
            InitMyFeature();
    }
}
```

**Rule:** Always call `super.*()` in every override. Never skip it.

---

## Pattern 1: Server Seeding Mode

Restrict players to MOB area until enough players connect.

```c
modded class SCR_GameModeCampaign
{
    [Attribute("0", UIWidgets.CheckBox, "Enable server seeding mode", category: "Seeding")]
    protected bool m_bServerSeedingEnabled;

    [Attribute("0", UIWidgets.EditBox, "Players needed to exit seeding (0=disabled)", "0 128 1", category: "Seeding")]
    protected int m_iServerSeedingThreshold;

    bool GetIsServerSeedingEnabled() { return m_bServerSeedingEnabled; }
    int GetServerPlayerThreshold() { return m_iServerSeedingThreshold; }
}
```

Layer-side entities needed:

- `IRON_SeedingRestrictionZoneEntity` child on each MOB with `m_bAutoSizeToHQ 1`
- `SCR_CampaignSpawnPointGroup` with `m_bOnlyShowDuringSeeding 1` near MOBs
- Seeding patrols in `AmbientPatrols_SEEDING.layer` using `IRON_AmbientPatrolSpawnpoint_Base_Seeding.et`

Seeding state manager (`Iron_SeedingSystemManager`) logic:

1. On init: if `m_bServerSeedingEnabled`, set seeding = true
2. On each player connect/spawn: check player count vs threshold
3. Once threshold crossed → seeding = false, **permanently** (one-way)
4. Restriction zones deactivate, seeding spawn points hide

---

## Pattern 2: Battle Prep Timer

Show a countdown before combat starts (warmup phase).

```c
modded class SCR_GameModeCampaign
{
    [Attribute("0", UIWidgets.CheckBox, "Show battle prep timer", category: "Battle Prep")]
    protected bool m_bShowBattlePrepTimer;

    [Attribute("600", UIWidgets.Slider, "Battle prep duration (s)", "1 1800 1", category: "Battle Prep")]
    protected int m_iBattlePrepTimeS;

    bool ShowBattlePrepTimer() { return m_bShowBattlePrepTimer; }
    float GetBattlePrepTime() { return m_iBattlePrepTimeS; }

    override void OnGameModeStart()
    {
        super.OnGameModeStart();
        if (m_bShowBattlePrepTimer && Replication.IsServer())
            GetGame().GetCallqueue().CallLater(EndBattlePrep, m_iBattlePrepTimeS * 1000, false);
    }

    protected void EndBattlePrep()
    {
        // Unlock spawning, enable base seizing, etc.
        SetBattlePrepEnded(true);
    }
}
```

---

## Pattern 3: Asymmetric Attack-Defend (AAD / AAS)

One faction defends fixed bases; the other attacks in sequence.

```c
modded class SCR_GameModeCampaign
{
    [Attribute("0", UIWidgets.CheckBox, "Enable AAD mode", category: "AAD")]
    protected bool m_bAADEnabled;

    [Attribute("FIA", UIWidgets.EditBox, "Defending faction key", category: "AAD")]
    protected string m_sAADDefendingFaction;

    [Attribute("US", UIWidgets.EditBox, "Attacking faction key", category: "AAD")]
    protected string m_sAADAttackingFaction;

    [Attribute("-1", UIWidgets.EditBox, "Min players before defending restriction (-1=none)", category: "AAD")]
    protected int m_iRestrictDefendingFactionThreshold;

    bool IsAADEnabled() { return m_bAADEnabled; }
    string GetAADDefendingFaction() { return m_sAADDefendingFaction; }
    string GetAADAttackingFaction() { return m_sAADAttackingFaction; }
    int GetAADDefendingTeamRestrictionThreshold() { return m_iRestrictDefendingFactionThreshold; }

    override void OnPlayerSpawnFinalize_S(int playerId, IEntity controlledEntity)
    {
        super.OnPlayerSpawnFinalize_S(playerId, controlledEntity);
        if (!m_bAADEnabled) return;
        // Show faction-specific briefing message
        SCR_HintManagerComponent.ShowHint(playerId, GetFactionBriefing(playerId));
    }

    // Prevent attacker faction from losing CP count change
    override void SetControlPointsHeld(Faction faction, int count)
    {
        if (m_bAADEnabled && faction.GetFactionKey() == m_sAADDefendingFaction)
            return; // Defending faction CP count locked
        super.SetControlPointsHeld(faction, count);
    }
}
```

Base manager override for AAD HQ selection:

```c
modded class SCR_CampaignMilitaryBaseManager
{
    override protected void SelectHQsSimple()
    {
        SCR_GameModeCampaign gm = SCR_GameModeCampaign.Cast(GetGame().GetGameMode());
        if (!gm || !gm.IsAADEnabled())
        {
            super.SelectHQsSimple();
            return;
        }
        // Separate attacker/defender bases, assign HQs per faction
        SelectAADHQs(gm.GetAADDefendingFaction(), gm.GetAADAttackingFaction());
    }
}
```

---

## Pattern 4: Supply Distribution Override

Distribute harbor income evenly across all owned friendly bases instead of pooling at harbors.

```c
modded class SCR_GameModeCampaign
{
    [Attribute("0", UIWidgets.CheckBox, "Distribute harbor supplies evenly", category: "Supplies")]
    protected bool m_bSupplyHarborDistributionEnabled;

    [Attribute("50", UIWidgets.EditBox, "Supplies per harbor tick per base", category: "Supplies")]
    protected int m_iSupplyHarborDistributionAmount;

    bool GetSupplyHarborDistributionEnabled() { return m_bSupplyHarborDistributionEnabled; }
    int GetSupplyHarborDistributionAmount() { return m_iSupplyHarborDistributionAmount; }
}
```

---

## Pattern 5: Base Building Rules Override

Block base establishment near enemy radio coverage.

```c
modded class SCR_CampaignMilitaryBaseManager
{
    override bool CanFactionBuildNewBase(notnull Faction faction)
    {
        SCR_GameModeCampaign gm = SCR_GameModeCampaign.Cast(GetGame().GetGameMode());
        if (!gm || !gm.GetDisableEstablishingBasesWithinEnemyRange())
            return super.CanFactionBuildNewBase(faction);

        // Find any enemy base within radio range of the proposed position
        array<SCR_CampaignMilitaryBaseComponent> enemyBases = {};
        GetBasesAtRange(proposedPos, radioRange, enemyBases, enemyFaction);
        foreach (SCR_CampaignMilitaryBaseComponent enemyBase : enemyBases)
        {
            if (enemyBase.IsHQRadioTrafficPossible(enemyFaction) != SCR_ERadioCoverageStatus.NONE)
                return false; // Too close to enemy radio
        }
        return super.CanFactionBuildNewBase(faction);
    }

    override void ProcessRemnantsPresence()
    {
        super.ProcessRemnantsPresence();
        // Clean up AI patrols that are too close to MOBs
        const float HQ_NO_REMNANTS_RADIUS = 300;
        const float HQ_NO_REMNANTS_PATROL_RADIUS = 600;
        // ... iterate bases, disable patrols within radius
    }
}
```

---

## Pattern 6: Scaled Respawn Timer

Increase respawn penalty per death, scale by rank.

```c
modded class SCR_GameModeCampaign
{
    [Attribute("1", UIWidgets.CheckBox, "Scale respawn timer by rank", category: "Respawn")]
    protected bool m_bScaleRespawnTimer;

    [Attribute("5", UIWidgets.EditBox, "Respawn penalty per death (s)", "0 120 1", category: "Respawn")]
    protected int m_iRespawnPenalty;

    [Attribute("90", UIWidgets.EditBox, "Max respawn penalty (s)", "0 300 1", category: "Respawn")]
    protected int m_iMaxRespawnPenalty;

    [Attribute("1200", UIWidgets.EditBox, "Penalty cooldown (s)", "0 3600 1", category: "Respawn")]
    protected int m_iRespawnPenaltyCooldown;

    // Rank-specific base respawn times (seconds)
    [Attribute("20")] protected int m_iRespawnPenaltyRenegade;
    [Attribute("5")]  protected int m_iRespawnPenaltyPrivate;
    [Attribute("5")]  protected int m_iRespawnPenaltyCorporal;
    [Attribute("4")]  protected int m_iRespawnPenaltySergeant;
    [Attribute("4")]  protected int m_iRespawnPenaltyLieutenant;
    [Attribute("3")]  protected int m_iRespawnPenaltyCaptain;
    [Attribute("3")]  protected int m_iRespawnPenaltyMajor;
}
```

---

## Pattern 7: Auto-Load Latest Save (PvE)

Automatically resume from the most recent save when the server restarts.

```c
modded class SCR_GameModeCampaign
{
    override void OnGameModeStart()
    {
        super.OnGameModeStart();
        if (Replication.IsServer())
            GetGame().GetCallqueue().CallLater(LoadLatestSave, 3000, false);
    }

    protected void LoadLatestSave()
    {
        SCR_SaveGameManager saveMgr = SCR_SaveGameManager.GetInstance();
        if (!saveMgr) return;
        array<string> saves = {};
        saveMgr.GetAvailableSaves(saves);
        if (!saves.IsEmpty())
            saveMgr.Load(saves[saves.Count() - 1]);
    }
}
```

---

## Pattern 8: Player Spawn Validation

Gate spawning with custom conditions (radio coverage, rank, supplies).

```c
modded class SCR_GameModeCampaign
{
    override bool CanPlayerSpawn_S(int playerId)
    {
        if (!super.CanPlayerSpawn_S(playerId)) return false;

        // Radio coverage check
        SCR_CampaignMilitaryBaseComponent base = GetSelectedBase(playerId);
        if (base)
        {
            Faction faction = GetPlayerFaction(playerId);
            if (base.IsHQRadioTrafficPossible(faction) == SCR_ERadioCoverageStatus.NONE)
                return false;

            // Supply check
            if (base.GetSupplyLimit() > 0 && base.GetScarcityLevel() <= 0)
                return false;
        }

        return true;
    }
}
```

---

## Pattern 9: XP / Rank Persistence (Cross-Session)

Save and restore player ranks across server restarts.

```c
class PersistentRank_Util
{
    // Hierarchical sharding avoids large flat directories
    static string GetDirectory(string identity)
    {
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
        string identity;
        BackendApi.GetPlayerIdentityId(playerId, identity);
        string path = GetDirectory(identity) + identity;
        FileHandle file = FileIO.OpenFile(path, FileMode.READ);
        if (!file) return false;
        string data;
        file.ReadLine(data);
        file.Close();
        rank = typename.StringToEnum(SCR_ECharacterRank, data);
        return true;
    }

    static void ApplyPlayerRank(int playerId, SCR_ECharacterRank rank)
    {
        SCR_XPHandlerComponent xpComp = SCR_XPHandlerComponent.Cast(
            GetGame().GetGameMode().FindComponent(SCR_XPHandlerComponent));
        if (!xpComp) return;
        SCR_CampaignFactionManager factionMgr = SCR_CampaignFactionManager.Cast(
            GetGame().GetGameMode().FindComponent(SCR_CampaignFactionManager));
        if (!factionMgr) return;
        int current = xpComp.GetXP(playerId);
        int required = factionMgr.GetRequiredRankXP(rank);
        int gap = required - current;
        if (gap > 0)
            xpComp.AwardXP(playerId, SCR_EXPRewards.UNDEFINED, 1, false, gap);
    }
}

modded class SCR_GameModeCampaign
{
    override void OnPlayerAuditSuccess(int playerId)
    {
        super.OnPlayerAuditSuccess(playerId);
        SCR_ECharacterRank rank;
        if (PersistentRank_Util.LoadRank(playerId, rank))
            GetGame().GetCallqueue().CallLater(
                PersistentRank_Util.ApplyPlayerRank, 5000, false, playerId, rank);
    }
}

// Save on rank change
modded class SCR_CharacterRankComponent
{
    override void OnPostInit(IEntity owner)
    {
        super.OnPostInit(owner);
        s_OnRankChanged.Insert(OnRankChanged);
    }

    protected void OnRankChanged(SCR_ECharacterRank rank, int playerId)
    {
        PersistentRank_Util.SaveRank(playerId, rank);
    }
}
```

---

## Pattern 10: Ambient AI Battle Zones

Enable AI faction battles in dead areas of the map.

```c
modded class SCR_GameModeCampaign
{
    [Attribute("0", UIWidgets.CheckBox, "Enable ambient AI battles", category: "AI")]
    protected bool m_bEnableAmbientAIBattles;

    [Attribute("32", UIWidgets.Slider, "Disable AI battles above X players", "1 128 1", category: "AI")]
    protected int m_iAmbientAIBattlePlayerThreshold;

    bool GetEnableAmbientAIBattles() { return m_bEnableAmbientAIBattles; }
    int GetAmbientAIBattlePlayerThreshold() { return m_iAmbientAIBattlePlayerThreshold; }
}
```

Layer: add `AmbientAIZone.layer` with AI zone entities. Enable/disable based on player count threshold.

---

## Common `[Attribute]` UIWidget Types

| Widget               | Use                         |
| -------------------- | --------------------------- |
| `UIWidgets.CheckBox` | bool on/off                 |
| `UIWidgets.EditBox`  | int or string value         |
| `UIWidgets.Slider`   | int range: `"min max step"` |
| `UIWidgets.ComboBox` | enum dropdown               |

Attribute signature: `[Attribute("defaultValue", widgetType, "Tooltip description", "params", "CategoryName")]`

---

## Key Rules

1. **Always `modded class`** — `class SCR_GameModeCampaign` creates a dead class nothing uses
2. **Always call `super.*()` first** in every override
3. **Server-only logic** — guard with `if (!Replication.IsServer()) return;`
4. **Delayed init** — base manager not ready at `OnGameModeStart`. Use `CallLater(myInit, 500)` for lookups
5. **Add a getter for every attribute** — other systems (`SCR_CampaignMilitaryBaseManager`, layer scripts) query via getter
6. **File location** — always `scripts/Game/GameMode/SCR_GameModeCampaign_modded.c`
