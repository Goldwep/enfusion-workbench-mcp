# Arma Reforger 1.8 — Modding Migration Notes

Stable **1.8.0.10** (released 2026-08-13). What changed for modders, distilled from the
official changelog (https://reforger.armaplatform.com/news/changelog-august-13-2026).
Platform note: the Microsoft Store / Xbox Play Anywhere PC version does **not** include
Arma Reforger Tools — Steam remains the modding platform.

---

## Breaking changes — check your mod

1. **Boots slot class swap.** `BaseLoadoutManagerComponent` switched the Boots slot from
   `LoadoutSlotInfo` to `SCR_FeetLoadoutSlotInfo`. Any mod whose character prefabs add or
   change character boots must update the slot class.
2. **Terrain mods must recompile normal maps** — they now carry an alpha channel used as
   the grass-coverage mask for the new Far Hide system (distant characters concealed
   against grass).
3. **Material mods** (weapons, uniforms, etc.) need the new **Enable Far Hiding** property
   set under *Basic Material Properties*.
4. **One TurretComponent per entity.** Multiple `TurretComponent`s on a single entity are
   now prevented — create separate turret entities instead.
5. **Rename:** `ScriptedStateConfig` → `StateConfig`. Update any script referencing the
   old name.
6. **Deprecated (still present, migrate to `ObserversSystem`):**
   `ChimeraWorld.GetObservers`, `ChimeraWorld.GetObserverMP`,
   `RplComponent.InsertMPObserver`, `ChimeraWorld.RemoveMPObserver`.

## New script API worth knowing

- `ObserversSystem` — new home for observer management (replaces the deprecated calls above).
- `AIControlComponent.ActivateAI` / `AIAgent.ActivateAI` — optional bool to respect the
  world active-AI limit; `AIGroup.ForceActivateAllMembers`.
- `EntityUtils.GetEntityPrefabName`, `EntityUtils.SetVObjectFromPrefab`.
- `GameMode.GetRplComponent`.
- `ChimeraWorld.LoadSystems` — load only the systems named in a config
  (e.g. `{3A1DEDB2A5818B53}Configs/Systems/MapPreviewSystemsConfig.conf`, used for
  map RT gadgets like compass/watch).
- `BaseLoadoutManagerComponent.GetClothesOffsetFront` + `SCR_OnLoadoutChanged` callback.
- Character `EventHandlerManagerComponent` raises `OnFreeLookStateChanged(bool)`.
- `SCR_BaseRadialCommand` — local-only commands, use-command-user-as-target, usable
  outside a group (emotes/gestures).
- `SCR_PlayerListBaseAction` — custom Player List context actions, registered in
  `PlayerListActions.conf`.
- `SCR_RecoilForceAimModifier` — recoil-direction bias; supports turrets with
  non-replicated projectiles.
- `SCR_LoiterCustomAnimationData` — Loiter Item Preset ID for locally-spawned loiter
  prefabs (smoking `{6D1E4A07F6BCAB7D}`, chair-sitting `{87FC57766897BBE2}`);
  `SCR_ContinuousLoiterCommand` accepts Custom Animation Data.
- Unified `Serialize` / `DeserializeSpawn` / `DeserializeLoad` API shared between
  entities and other managed instances.
- Vehicles: Engine Moment of Inertia auto-calculated when 0; new Engine Braking Torque
  Ratio auto-calculates engine Friction when 0.

## Workbench / World Editor tooling

- **`BaseWorldSetup.conf`** — auto-adds basic world entities to new terrains
  (World Editor Plugins → World Setup → Entities Setup).
- Dedicated Server Tool plugin: button to start only clients.
- Navmesh custom links: new *max snapping height*; *max snapping distance* now checked
  horizontally (snapping volume is a cylinder, not a sphere); `NavmeshCustomLinkBase`
  reports the offending prefab/entity name on invalid settings; link ends below ground
  now snap to terrain (fixes AI-unusable ladders).
- **Doxygen docs layout changed:** the Tools now ship unpacked directories
  (`Workbench/docs/ArmaReforgerScriptAPIPublic/`, `Workbench/docs/EnfusionScriptAPI/`)
  instead of zips — and the standalone Enfusion API is back after being consolidated
  into the Arma zip in 1.7.

## Config / server

- Mission header field: minimum players for base contesting (or disable contesting).
- Faction-specific override to prevent teamkill kicks.
- New configs: `FragmentationDamageEffect_ATMine.conf`, `PlayerListActions.conf`,
  `MapPreviewSystemsConfig.conf`.
- No server.json core field renames; no workshop/publishing pipeline changes.

## Content

No new factions, vehicles, or maps. Equipment-level additions (deployable razorwire,
M203 smoke rounds, FIA camo netting, SVD bayonet), new gesture/loiter animations.
Gameplay headlines for context: Far Hide, grass/camo occluding AI vision, specialist
role speed bonuses, rank-point death penalty, admin camera tools.

---

## Hotfix 1.8.0.13 (released 2026-09-03)

Hotfix-scale; same Doxygen build branch (`stable_1_88_80`). Modding-relevant items from the
official changelog (https://reforger.armaplatform.com/news/update-september-3-2026):

- **`SCR_AnalyticsApplication` world system is now enabled** (plus a new Analytics opt-in in
  Gameplay settings) — mods that stubbed or assumed it inactive may behave differently.
- **Group-creation rules tightened server-side:** a new-group request joins an existing group
  with matching name/description/privacy (or reconfigures it); no new group if your solo group
  already matches; private groups only when the request auto-joins the creator; no groups that
  would survive the last player leaving; privacy changes only where the group allows them.
  Mods overriding the group-creation flow should re-test.
- Fixes touching script behavior: `HitZone::SetHealthScaled` inside damage handling no longer
  yields a wrong damage state; `IOP.Reset` now covered by the lock (MT safety); persistence
  script rules are invoked again; `SCR_CampaignBuildingTransformingEditorComponent` server VME.
- Workbench: TDR crash prevention when generating the Shore map; building-editor null pointer
  and map-scale division-by-zero VMEs fixed.
- RCON: crash using vanilla scripted commands on a modded server fixed; client logs server
  id/name on join; better commander logging.
- No API additions/deprecations/renames, no content re-GUIDing, no pak/packaging or Workshop
  changes. Six paks were repacked (data007, data010, worlds, worlds001, worlds002,
  shaders-dx12) — the reader's dual-generation logic handles them unchanged.
