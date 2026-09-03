# Live Workbench test plan

This document specifies verifiable test cases for the `wb_*` (live Workbench) MCP tool cluster shipped by `Enfusion-Workbench-MCP-Goldwep`. Every tool registered via `registerWb*` in `src/server.ts` is covered, and where a tool has an `action` enum, each viable action gets its own case. The MUST-test items (BLUFOR spawn area, unit attribute mutation, arsenal placement, loadout definition) are spelled out step-by-step.

## Pre-conditions

1. **Workbench running.** `ArmaReforgerWorkbenchSteamDiag.exe` is alive with the **Test1** addon's gproj loaded and the **Testerz** world (Arland sub-scene) open in the World Editor. `wb_state` reports `Mode=edit`, `Entity Count ~ 173000+`, `Terrain Bounds` non-zero.
2. **EMCP handlers deployed.** `wb_launch gprojPath=<Test1.gproj>` previously injected the `EMCP_WB_*.c` handler scripts under `<Test1>/Scripts/WorkbenchGame/EnfusionMCP/` and `wb_diagnose` returns NET API status = `up_with_handlers` on `127.0.0.1:5775`.
3. **Project index DB populated.** `~/.enfusion-mcp/project-index.db` exists; `project_index_status` returns at least the Test1 addon plus the inherited core + Arland refs.
4. **Recent run baseline.** Previous live exploration left several `US_Rifleman_01..08` entities + a spawned `Soldier` named `S1` at known coordinates (from earlier session). Test cases reuse these where useful; new tests create their own targets with unique names so the suite is rerunnable.
5. **Layer namespace.** Tests create layers under `default/EMCP_Test_*` so cleanup is mechanical (delete the `EMCP_Test_*` parent at the end). No tests delete vanilla layers.
6. **Naming convention.** All test-created entities are prefixed `EMCP_*` to keep them grepable for cleanup.

## Known-good prefab paths (sourced from `data/kb/patterns` and `data/wiki/pages.json`)

| Use case | Path (use as `prefab` arg to `wb_entity_create`) | Source |
|---|---|---|
| Base spawn point (set faction via prop) | `{E7F4D5562F48DDE4}Prefabs/MP/Spawning/SpawnPoint_Base.et` | `data/kb/patterns/GameModes_And_Scenarios/conflict-scenario-setup.md:578` |
| Pre-set US spawn point (path-only, no KB GUID — resolve at runtime) | `Prefabs/MP/Spawning/SpawnPoint_US.et` — call `wb_prefabs action=getGuid templatePath=<path>` first **OR** rely on Workbench accepting bare path via `wb_entity_create` (previous exploration showed this works) | `data/kb/patterns/GameModes_And_Scenarios/scenario-framework.md:2321`, `capture-and-hold.md:32` |
| Pre-set USSR spawn point | `Prefabs/MP/Spawning/SpawnPoint_USSR.et` | same KB block |
| Pre-set FIA spawn point | `Prefabs/MP/Spawning/SpawnPoint_FIA.et` | same KB block |
| Campaign spawn point group | `{E10B6FCE03AA6905}Prefabs/MP/Campaign/CampaignSpawnPointsGroup.et` | `conflict-scenario-setup.md:534`, `conflict-seeding-system.md:116` |
| Ambient patrol spawn point (FIA) | `{9273AB931008C271}Prefabs/Systems/AmbientPatrol/AmbientPatrolSpawnpoint_FIA.et` | `conflict-scenario-setup.md:396`, `conflict-layer-reference.md:113` |
| Ambient vehicle spawn point (US) | `{67EE7343073E3AF4}Prefabs/Systems/AmbientVehicles/AmbientVehicleSpawnpoint_US.et` | `conflict-scenario-setup.md:77`, `conflict-layer-reference.md:121` |
| Ambient vehicle spawn point (USSR) | `{644AEC5C537E03F0}Prefabs/Systems/AmbientVehicles/AmbientVehicleSpawnpoint_USSR.et` | same blocks |
| Arsenal weapons box (US) | `{377EB906F591E4BA}` path tail `AmmoBoxArsenal_Weapons_US.et` (full path truncated in KB — verify via `wb_prefabs action=getGuid`) | `scenario-framework.md:564` |
| Arsenal box (US) | `Prefabs/Props/Military/Arsenal/ArsenalBoxes/US/ArsenalBox_US.et` — path-only, resolve GUID at runtime | `data/wiki/pages.json:1061`, `scenario-framework.md:2270` |
| US unarmed character (faction baseline) | `{2F912ED6E399FF47}Prefabs/Characters/Factions/BLUFOR/US_Army/Character_US_Unarmed.et` | `scenario-framework.md:1603` |
| USSR unarmed character | `{98EB9CDD85B8C92C}Prefabs/Characters/Factions/OPFOR/USSR_Army/Character_USSR_Unarmed.et` (path verified by class hierarchy) | `scenario-framework.md:1335` |
| Faction manager (US x USSR) | `Prefabs/MP/Managers/Factions/FactionManager_USxUSSR.et` | `conflict-scenario-setup.md:1043`, `capture-and-hold.md:29` |
| Loadout manager (US x USSR) | `Prefabs/MP/Managers/Loadouts/LoadoutManager_USxUSSR.et` | same blocks |
| Vehicle example (M1025 — already used in scenario-framework KB) | `{4A71F755A4513227}Prefabs/Vehicles/Wheeled/M998/M1025.et` | `scenario-framework.md:434` |

**Gap callouts:**

- The exact GUIDs for `SpawnPoint_US.et` / `SpawnPoint_USSR.et` / `SpawnPoint_FIA.et` are **NOT** present in `data/kb` or `data/wiki/pages.json` — only their paths. Previous live exploration found that `wb_entity_create` accepts a bare resource path (the NET API's `EMCP_WB_CreateEntity` handler resolves it), but `wb_prefabs action=getGuid` returns "not found" for paths that DO work via create. The test plan therefore uses **bare paths** for these three and treats GUID lookup failure as a known regression, not a TC failure.
- The Arsenal `ArsenalBox_US.et` GUID is also not in our KB — only the path. Same fallback strategy.
- Both Workshop-mod GUIDs (e.g., conflict-escalation IRON_*) belong to community mods that may not be present in Test1's dependency tree; they're listed for reference but TCs default to vanilla prefabs.

## Test cases — `wb_*` cluster

### Connection + state cluster

#### TC-LW-001: `wb_state` baseline snapshot
- **Input:** `{}`
- **Expected:** Markdown response listing `Mode=edit`, `Entity Count` >= 173000, `Selected` (0 unless prior leftover), `Sub-Scene` >= 0, `Terrain Bounds` non-empty (`boundsMin`/`boundsMax` populated). Footer says `Workbench: edit mode`.
- **Pass criteria:** Mode == "edit"; entityCount > 100000; boundsMin and boundsMax both present.
- **Risk:** None — read-only.

#### TC-LW-002: `wb_connect` ping liveness
- **Input:** `{}`
- **Expected:** `Status: Connected`; `Mode:` field matches `wb_state`'s mode.
- **Pass criteria:** `details.mode` matches TC-LW-001's mode.
- **Risk:** None.

#### TC-LW-003: `wb_diagnose` full report
- **Input:** `{}`
- **Expected:** Sections: Configuration, Handler Scripts, NET API Connection. Reports `up_with_handlers`; lists Test1 in `installedMods`. `standaloneAddon.exists` should be **false** (handlers injected into Test1, not standalone).
- **Pass criteria:** `netApi == "up_with_handlers"`; at least one `installedMods` entry pointing at Test1; no `### Issues Detected` block emitted.
- **Risk:** None.

#### TC-LW-004: `wb_launch` idempotent re-launch
- **Input:** `{}` (no args — Workbench already running)
- **Expected:** `**Workbench Already Running**` — NET API responded on first ping, handler-copy step skipped.
- **Pass criteria:** Response contains "Already Running" and does not re-copy `Scripts/WorkbenchGame/EnfusionMCP/`.
- **Risk:** None unless Workbench was somehow killed between TC-LW-003 and TC-LW-004 — in which case `wb_launch` will relaunch (acceptable side-effect, but flag in report).

#### TC-LW-005: `wb_launch` with gprojPath while running
- **Input:** `{ "gprojPath": "<absolute-path-to-Test1.gproj>" }`
- **Expected:** Still `Already Running` (no relaunch), but `config.defaultMod` is set to `Test1` so subsequent tools that rely on `defaultMod` use it.
- **Pass criteria:** Response says "Already Running"; running `wb_diagnose` again afterward shows `Default Mod: Test1`.
- **Risk:** None — `wb_launch` short-circuits on `client.ping()` true.

### Editor control cluster

#### TC-LW-006: `wb_save` save current world
- **Input:** `{}` (no path → action=save, not saveAs)
- **Expected:** `**Save Complete**` with `World saved.` text. Timeout 30s window — if Workbench opens a Save As dialog (new world), response says `**Save Pending**` (acceptable — caller must confirm in UI).
- **Pass criteria:** No `Error:` prefix; response is either `Save Complete` or `Save Pending`.
- **Risk:** Saves the world. Acceptable because Test1/Testerz is the persistent test world.

#### TC-LW-007: `wb_undo_redo` action=undo
- **Setup:** Prior TC (TC-MUST-1 step that creates an entity) must run first so there's something to undo. If running stand-alone, first create + delete a dummy entity, then run this case.
- **Input:** `{ "action": "undo" }`
- **Expected:** `**Undo Complete**`.
- **Pass criteria:** No error; subsequent `wb_state` shows entity count decreased by 1 (or whatever the last op affected).
- **Risk:** Affects scene state. Reversible via `action=redo`.

#### TC-LW-008: `wb_undo_redo` action=redo
- **Setup:** TC-LW-007 must run first.
- **Input:** `{ "action": "redo" }`
- **Expected:** `**Redo Complete**`; entity count returns to pre-undo value.
- **Pass criteria:** Entity count back to what it was before TC-LW-007.
- **Risk:** Same as TC-LW-007.

#### TC-LW-009: `wb_open_resource` open a prefab
- **Input:** `{ "path": "Prefabs/MP/Spawning/SpawnPoint_Base.et" }`
- **Expected:** `**Resource Opened**` listing the path. Workbench's Prefab Editor tab opens.
- **Pass criteria:** No error; UI verification optional (visual side-effect only).
- **Risk:** Opens a tab — harmless. Can be closed in UI.

#### TC-LW-010: `wb_open_resource` invalid path
- **Input:** `{ "path": "Prefabs/Does/Not/Exist.et" }`
- **Expected:** Error or null result; check that the tool surfaces the failure cleanly (no swallowed exception). Per `ERROR-UX.md`: should return `Error opening resource: ...` with `isError: true`.
- **Pass criteria:** `isError: true` + descriptive message; not a silent success.
- **Risk:** None.

#### TC-LW-011: `wb_execute_action` Tools menu reload (read-only-ish)
- **Input:** `{ "menuPath": "Tools,Reload Scripts" }`
- **Expected:** `**Action Executed**` for `Tools,Reload Scripts` — same effect as `wb_reload target=scripts`.
- **Pass criteria:** No error; subsequent `wb_state` still reports mode=edit.
- **Risk:** Triggers script recompile — harmless.

#### TC-LW-012: `wb_execute_action` blocked menu path
- **Input:** `{ "menuPath": "File,Close" }`
- **Expected:** `**Blocked:**` message saying File,Close is destructive and can't be executed.
- **Pass criteria:** Response includes "Blocked" and the menu path; no actual close.
- **Risk:** None — verifies the guard.

#### TC-LW-013: `wb_execute_action` unknown menu path
- **Input:** `{ "menuPath": "ThisIsNot,A Real,Menu Path" }`
- **Expected:** Error returned from the EMCP handler — surfaces as `Error executing action`.
- **Pass criteria:** `isError: true` with diagnostic message.
- **Risk:** None.

#### TC-LW-014: `wb_play` then `wb_stop` (mode toggle)
- **Note:** Run as paired test. Risk = high; mode change affects subsequent TCs.
- **Step 1 input:** `{ "debugMode": false, "fullScreen": false }` to `wb_play`
- **Step 1 expected:** `**Play Mode Started**`. Subsequent `wb_state` reports `Mode=play`.
- **Step 2 input:** `{}` to `wb_stop`
- **Step 2 expected:** `**Edit Mode Restored**`. Subsequent `wb_state` reports `Mode=edit`.
- **Pass criteria:** Round-trip mode change works; final state is edit mode.
- **Risk:** Play mode loads the game runtime — heavy. If `wb_stop` fails to fire, all subsequent edit-mode TCs will be blocked. Plan: skip this TC and rerun only if mode is restored, or wrap in manual checkpoint.

#### TC-LW-015: `wb_play` blocked while already in play mode
- **Setup:** Must be in play mode (run TC-LW-014 step 1 first, then this TC before step 2).
- **Input:** `{}` to `wb_play` again
- **Expected:** `Cannot start play mode while in play mode. Call wb_stop first...`
- **Pass criteria:** Error message references `wb_stop`; no second `wb_play` call goes through.
- **Risk:** None.

#### TC-LW-016: `wb_stop` blocked while already in edit mode
- **Setup:** Edit mode (default).
- **Input:** `{}` to `wb_stop`
- **Expected:** `Cannot stop play mode while in edit mode. Call wb_play first...`
- **Pass criteria:** Error message references `wb_play`; tool refuses.
- **Risk:** None.

### Reload cluster

#### TC-LW-017: `wb_reload` target=scripts
- **Input:** `{ "target": "scripts" }`
- **Expected:** `**Reload Complete**`.
- **Pass criteria:** No error; logs (via `logs_tail`) show a script recompile event.
- **Risk:** Recompiles all scripts — heavy but safe.

#### TC-LW-018: `wb_reload` target=plugins
- **Input:** `{ "target": "plugins" }`
- **Expected:** `**Reload Complete**`.
- **Pass criteria:** No error.
- **Risk:** Reloads Workbench plugins — heavy.

#### TC-LW-019: `wb_reload` target=both
- **Input:** `{ "target": "both" }`
- **Expected:** Same as the two above combined.
- **Pass criteria:** No error.
- **Risk:** Highest of the three — both recompile + plugin reload.

### Terrain cluster

#### TC-LW-020: `wb_terrain` action=getBounds (Arland)
- **Input:** `{ "action": "getBounds" }`
- **Expected:** Response lists `Min X`, `Min Z`, `Max X`, `Max Z`, `Size X`, `Size Z`, `Grid Size`. For Arland (12.8km), `sizeX` and `sizeZ` should both be 12800.
- **Pass criteria:** All six fields present and numeric; sizeX == sizeZ == 12800 (Arland) or 51200 (Everon — not expected here).
- **Risk:** None — read-only.

#### TC-LW-021: `wb_terrain` action=getHeight at center
- **Input:** `{ "action": "getHeight", "x": 6400, "z": 6400 }` (Arland center)
- **Expected:** `Height (Y):` reported as a float (Arland center is roughly sea level — likely 0–50 m).
- **Pass criteria:** Returned `height` is a finite number, not NaN, not 0.0 (Arland's center is above sea level).
- **Risk:** None.

#### TC-LW-022: `wb_terrain` action=getHeight at known elevation point
- **Setup:** Pick a point we know has elevation, e.g., `(2200, 2050)` near a hillside.
- **Input:** `{ "action": "getHeight", "x": 2200, "z": 2050 }`
- **Expected:** Height value > 0.
- **Pass criteria:** height > 0.
- **Risk:** None.

#### TC-LW-023: `wb_terrain` action=getHeight missing coords
- **Input:** `{ "action": "getHeight" }` (no x/z)
- **Expected:** `Error: x and z coordinates are required for getHeight.`
- **Pass criteria:** `isError: true`.
- **Risk:** None.

### Layers cluster (10 actions)

#### TC-LW-024: `wb_layers` action=list (baseline)
- **Input:** `{ "action": "list" }`
- **Expected:** Markdown list of layers. Should include `default` and any session-leftovers. Lists `Active layer`.
- **Pass criteria:** Response contains `default` layer; `entityCount` (when present) > 0 for default.
- **Risk:** None.

#### TC-LW-025: `wb_layers` action=create
- **Input:** `{ "action": "create", "name": "EMCP_Test_Spawn", "parentPath": "default" }`
- **Expected:** `**Layer Updated**` with `Created layer "EMCP_Test_Spawn" under default`.
- **Pass criteria:** Subsequent `wb_layers action=list` shows `default/EMCP_Test_Spawn`.
- **Risk:** Adds a layer — cleanup at end via `action=delete`.

#### TC-LW-026: `wb_layers` action=setActive
- **Setup:** TC-LW-025 ran.
- **Input:** `{ "action": "setActive", "layerPath": "default/EMCP_Test_Spawn" }`
- **Expected:** `Set active layer to "default/EMCP_Test_Spawn"`.
- **Pass criteria:** `wb_layers action=list` afterward shows `[ACTIVE]` flag on `default/EMCP_Test_Spawn`.
- **Risk:** Subsequent `wb_entity_create` calls will go into this layer unless overridden.

#### TC-LW-027: `wb_layers` action=getInfo
- **Setup:** TC-LW-025 + TC-LW-026 ran.
- **Input:** `{ "action": "getInfo", "layerPath": "default/EMCP_Test_Spawn" }`
- **Expected:** `**Layer default/EMCP_Test_Spawn**` with `Visible`, `Locked`, `Active`, `Entities`, `Layer ID`.
- **Pass criteria:** `Active: true`; `Visible: true`; `Locked: false`; `Entities: 0` (empty layer).
- **Risk:** None.

#### TC-LW-028: `wb_layers` action=isVisible
- **Setup:** TC-LW-025 ran.
- **Input:** `{ "action": "isVisible", "layerPath": "default/EMCP_Test_Spawn" }`
- **Expected:** `Visible: true`.
- **Pass criteria:** `layerVisible: true` field present.
- **Risk:** None.

#### TC-LW-029: `wb_layers` action=setVisibility hide
- **Input:** `{ "action": "setVisibility", "layerPath": "default/EMCP_Test_Spawn", "visible": false }`
- **Expected:** `Set "default/EMCP_Test_Spawn" visibility to hidden`.
- **Pass criteria:** `wb_layers action=isVisible` returns `false` afterward.
- **Risk:** None — visibility toggle is non-destructive.

#### TC-LW-030: `wb_layers` action=setVisibility show
- **Setup:** TC-LW-029 ran.
- **Input:** `{ "action": "setVisibility", "layerPath": "default/EMCP_Test_Spawn", "visible": true }`
- **Expected:** `Set "default/EMCP_Test_Spawn" visibility to visible`.
- **Pass criteria:** `isVisible` returns `true` afterward.
- **Risk:** None.

#### TC-LW-031: `wb_layers` action=lock
- **Input:** `{ "action": "lock", "layerPath": "default/EMCP_Test_Spawn" }`
- **Expected:** `Locked layer "default/EMCP_Test_Spawn"`.
- **Pass criteria:** `wb_layers action=getInfo` reports `Locked: true`.
- **Risk:** Subsequent entity creation in this layer will fail until unlocked. Pair with TC-LW-032.

#### TC-LW-032: `wb_layers` action=unlock
- **Setup:** TC-LW-031 ran.
- **Input:** `{ "action": "unlock", "layerPath": "default/EMCP_Test_Spawn" }`
- **Expected:** `Unlocked layer "default/EMCP_Test_Spawn"`.
- **Pass criteria:** `getInfo` reports `Locked: false`.
- **Risk:** None.

#### TC-LW-033: `wb_layers` action=toggleLock
- **Setup:** Layer unlocked (TC-LW-032 ran).
- **Input:** `{ "action": "toggleLock", "layerPath": "default/EMCP_Test_Spawn" }`
- **Expected:** `**Layer Lock Toggled**` saying layer is now locked.
- **Pass criteria:** `result.layerLocked == true`; subsequent toggle returns it to unlocked.
- **Risk:** Same as lock — pair with a second toggleLock to restore state.

#### TC-LW-034: `wb_layers` action=toggleLock (back to unlocked)
- **Setup:** TC-LW-033 ran (layer now locked).
- **Input:** Same as TC-LW-033.
- **Expected:** Layer back to unlocked.
- **Pass criteria:** `layerLocked == false`.
- **Risk:** None.

#### TC-LW-035: `wb_layers` action=rename
- **Input:** `{ "action": "rename", "layerPath": "default/EMCP_Test_Spawn", "name": "EMCP_Test_Spawn_R" }`
- **Expected:** `Renamed layer "default/EMCP_Test_Spawn" to "EMCP_Test_Spawn_R"`.
- **Pass criteria:** `wb_layers action=list` lists `EMCP_Test_Spawn_R`, not the old name.
- **Risk:** Subsequent TCs must use the new path. After this TC, rename back via another call to keep MUST-1 reusable.

#### TC-LW-036: `wb_layers` action=rename back
- **Setup:** TC-LW-035 ran.
- **Input:** `{ "action": "rename", "layerPath": "default/EMCP_Test_Spawn_R", "name": "EMCP_Test_Spawn" }`
- **Expected:** Layer back to `EMCP_Test_Spawn`.
- **Pass criteria:** List shows the original name.
- **Risk:** None.

#### TC-LW-037: `wb_layers` action=delete (cleanup)
- **Setup:** Run **after** all MUST-* tests that use this layer.
- **Input:** `{ "action": "delete", "layerPath": "default/EMCP_Test_Spawn" }`
- **Expected:** `Deleted layer "default/EMCP_Test_Spawn"`.
- **Pass criteria:** `wb_layers action=list` no longer shows the layer.
- **Risk:** Deletes the layer and any entities in it. Must be the LAST test using this layer.

#### TC-LW-038: `wb_layers` mutating action while in play mode
- **Setup:** Switch to play mode (TC-LW-014 step 1) then attempt create.
- **Input:** `{ "action": "create", "name": "EMCP_PlayMode_Block", "parentPath": "default" }`
- **Expected:** `Cannot create layer while in play mode. Call wb_stop first to return to edit mode.`
- **Pass criteria:** Error message; no layer created.
- **Risk:** None — verifies the guard.

### Resources cluster (5 actions)

#### TC-LW-039: `wb_resources` action=getInfo for an existing resource
- **Input:** `{ "action": "getInfo", "path": "{E7F4D5562F48DDE4}Prefabs/MP/Spawning/SpawnPoint_Base.et" }`
- **Expected:** `**Resource Info**` block listing GUID, Type, Size, possibly Dependencies.
- **Pass criteria:** GUID matches `E7F4D5562F48DDE4`; `Type` is "prefab" or similar.
- **Risk:** None.

#### TC-LW-040: `wb_resources` action=getInfo unknown path
- **Input:** `{ "action": "getInfo", "path": "Prefabs/Does/Not/Exist.et" }`
- **Expected:** Either an error or an info block with empty/null fields. Verify the response is parseable, not a crash.
- **Pass criteria:** No unhandled exception; response either has `isError: true` or shows `(not found)`.
- **Risk:** None.

#### TC-LW-041: `wb_resources` action=open
- **Input:** `{ "action": "open", "path": "Prefabs/MP/Spawning/SpawnPoint_Base.et" }`
- **Expected:** `**Opened resource:**`; same effect as `wb_open_resource`.
- **Pass criteria:** No error.
- **Risk:** Opens a tab — harmless.

#### TC-LW-042: `wb_resources` action=browse (known gap)
- **Input:** `{ "action": "browse", "path": "Prefabs/Characters/" }`
- **Expected:** Per `mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Resources.c:127`, the handler returns `"browse action not yet implemented: Workbench.SearchResources requires a WorkbenchSearchResourcesCallback subclass. Use wb_open_resource or project_browse instead."`. The TS wrapper passes this through unchanged.
- **Pass criteria:** Response contains the literal "browse action not yet implemented" string OR returns 0 entries with that message in `result.message`.
- **Risk:** None — this TC documents a known gap.

#### TC-LW-043: `wb_resources` action=register (read-only fixture)
- **Note:** Skipping a destructive register run. `wb_entity_duplicate` already exercises register on a fresh path; if independent verification is needed, copy a known `.et` to a test path under the mod and call register, then delete the copy.
- **Skip rationale:** Avoids polluting the mod's resource DB. `wb_entity_duplicate` covers register implicitly.

#### TC-LW-044: `wb_resources` action=rebuild (heavy — skipped by default)
- **Note:** A full rebuild can take minutes and isn't a unit test. Verify the handler accepts the call by inspecting `mod/.../EMCP_WB_Resources.c:106-110`. **Skip by default**; run manually only when needed.

#### TC-LW-045: `wb_resources` action=register while in play mode
- **Setup:** Play mode.
- **Input:** `{ "action": "register", "path": "<test-path>" }`
- **Expected:** `Cannot register resource while in play mode...`
- **Pass criteria:** Edit-mode guard error.
- **Risk:** None.

### Prefabs cluster (5 actions)

#### TC-LW-046: `wb_prefabs` action=getGuid for known base prefab
- **Input:** `{ "action": "getGuid", "templatePath": "Prefabs/MP/Spawning/SpawnPoint_Base.et" }`
- **Expected:** Returns GUID. Per the upstream behavior noted in the brief, some paths that work via `wb_entity_create` return `(not found)` here — that's a known regression. SpawnPoint_Base SHOULD work because we have its GUID in our KB.
- **Pass criteria:** Returns `E7F4D5562F48DDE4` for SpawnPoint_Base. If returns `(not found)`, document as a regression.
- **Risk:** None.

#### TC-LW-047: `wb_prefabs` action=getGuid for SpawnPoint_US (known gap)
- **Input:** `{ "action": "getGuid", "templatePath": "Prefabs/MP/Spawning/SpawnPoint_US.et" }`
- **Expected:** Per the brief, this path works via `wb_entity_create` but `getGuid` returns "not found". Pass = reproduces the known mismatch.
- **Pass criteria:** Either returns a GUID (good — gap closed) or returns `(not found)` (confirms known regression). Either outcome should be documented.
- **Risk:** None.

#### TC-LW-048: `wb_prefabs` action=locate (known stall on 173k entities)
- **Input:** `{ "action": "locate", "searchPath": "Prefabs/MP/Spawning" }`
- **Expected:** Per the brief, the NET API queue wedges on 173k entities. **Pass = times out or returns within an acceptable window.** Caller should set a 30s timeout; either a populated `prefabs` array OR an error is acceptable.
- **Pass criteria:** Tool returns within 60s with either success or timeout error. If it hangs the whole MCP, that's a fail and the bug is in the queue.
- **Risk:** Known stall behavior — run last in the suite.

#### TC-LW-049: `wb_prefabs` action=getAncestor for a known scene entity
- **Setup:** A `Soldier`-class entity exists in the scene (e.g., the prior session's `US_Rifleman_01` or a fresh one from TC-MUST-2).
- **Input:** `{ "action": "getAncestor", "entityName": "<existing-entity-name>" }`
- **Expected:** `**Ancestor Prefab**` listing `Entity: <name>` and `Ancestor: {GUID}Prefabs/...path.et`.
- **Pass criteria:** `ancestorPath` is non-empty and starts with `{`.
- **Risk:** None.

#### TC-LW-050: `wb_prefabs` action=createTemplate (saves an .et)
- **Setup:** A test entity with unique properties exists; pick one not needed by later TCs (e.g., spawn a vanilla soldier as `EMCP_Template_Donor`, modify a property, then save as template).
- **Input:** `{ "action": "createTemplate", "entityName": "EMCP_Template_Donor", "templatePath": "Prefabs/EMCP_Test/EMCP_Donor.et" }`
- **Expected:** `**Template Created**` with path and GUID.
- **Pass criteria:** File exists at `<Test1>/Prefabs/EMCP_Test/EMCP_Donor.et` on disk; `result.guid` is a 16-hex string.
- **Risk:** Writes a file. Delete via filesystem after the test.

#### TC-LW-051: `wb_prefabs` action=save (save changes back to a prefab)
- **Note:** Requires a prefab to be open in the Prefab Editor and modified. Best done as a paired test with `wb_open_resource` first, then a `wb_entity_modify` action on the editor target, then `save`. Skip if no prefab is being edited.
- **Input:** `{ "action": "save", "entityName": "<entity-inside-prefab-editor>" }`
- **Expected:** `**Prefab Saved**`.
- **Pass criteria:** No error; on-disk `.et` updated.
- **Risk:** Mutates a prefab file. Reversible via VCS.

### Clipboard cluster (6 actions)

#### TC-LW-052: `wb_clipboard` action=hasCopied (initial empty)
- **Input:** `{ "action": "hasCopied" }`
- **Expected:** `Clipboard: Empty` or `Has content` depending on the editor session's state.
- **Pass criteria:** Response includes one of `Empty` / `Has content`; no error.
- **Risk:** None.

#### TC-LW-053: `wb_clipboard` action=copy
- **Setup:** Select an entity first via `wb_entity_select action=select name=EMCP_*`.
- **Input:** `{ "action": "copy" }`
- **Expected:** `**Copied to clipboard**`; subsequent `hasCopied` returns true.
- **Pass criteria:** `count` is >= 1; `hasCopied` flips to true.
- **Risk:** None.

#### TC-LW-054: `wb_clipboard` action=paste
- **Setup:** TC-LW-053 ran.
- **Input:** `{ "action": "paste" }`
- **Expected:** `**Pasted from clipboard**`; entity count increases by `count`.
- **Pass criteria:** `wb_state` afterward shows entityCount up by 1.
- **Risk:** Adds an entity. Cleanup by tracking the pasted entity's auto-generated name and deleting it.

#### TC-LW-055: `wb_clipboard` action=pasteAtCursor
- **Setup:** TC-LW-053 ran (clipboard has content). Cursor position depends on user — may be off-screen, in which case paste behavior is undefined.
- **Input:** `{ "action": "pasteAtCursor" }`
- **Expected:** `**Pasted at cursor position**`.
- **Pass criteria:** Either success or a graceful "no cursor target" message. Not a crash.
- **Risk:** Adds an entity at uncertain location.

#### TC-LW-056: `wb_clipboard` action=duplicate
- **Setup:** Select an entity.
- **Input:** `{ "action": "duplicate" }`
- **Expected:** `**Duplicated selection**` with `count`.
- **Pass criteria:** Entity count increases; the duplicate exists with a `_1` or similar suffix.
- **Risk:** Adds an entity. Cleanup.

#### TC-LW-057: `wb_clipboard` action=cut
- **Setup:** Select an entity (one that's expendable — duplicate first if needed).
- **Input:** `{ "action": "cut" }`
- **Expected:** `**Cut to clipboard**` with `count`. Entity removed from scene; entity count decreases.
- **Pass criteria:** Original entity no longer in scene; `hasCopied` returns true.
- **Risk:** Removes an entity. Reversible by undo or paste.

### Script editor cluster (7 actions)

#### TC-LW-058: `wb_script_editor` action=getCurrentFile
- **Input:** `{ "action": "getCurrentFile" }`
- **Expected:** `**Current Script File:** <path or (no file open)>`.
- **Pass criteria:** Either a path or "(no file open)"; not an error.
- **Risk:** None.

#### TC-LW-059: `wb_script_editor` action=openFile
- **Input:** `{ "action": "openFile", "path": "Scripts/Game/EMCP_DoesNotMatter.c" }` — pick an existing script under Test1 or use a known core script path.
- **Expected:** `**Opened:** <path>` then `getCurrentFile` returns that path.
- **Pass criteria:** Subsequent `getCurrentFile` returns the opened path.
- **Risk:** Opens a tab — harmless.

#### TC-LW-060: `wb_script_editor` action=getLinesCount
- **Setup:** A script is open (TC-LW-059 ran).
- **Input:** `{ "action": "getLinesCount" }`
- **Expected:** `**Line Count:** <N>` where N > 0.
- **Pass criteria:** N is an integer > 0.
- **Risk:** None.

#### TC-LW-061: `wb_script_editor` action=getLine
- **Setup:** Script open with at least 1 line.
- **Input:** `{ "action": "getLine", "line": 1 }`
- **Expected:** `**Line 1:**` with the actual content of line 1.
- **Pass criteria:** Text content is non-empty (or empty if line 1 is genuinely blank).
- **Risk:** None.

#### TC-LW-062: `wb_script_editor` action=insertLine (mutating — skip by default)
- **Note:** Modifies a script file. **Skip by default**; only run with a throwaway script.
- **Input:** `{ "action": "insertLine", "line": 1, "text": "// EMCP test marker" }`
- **Expected:** `**Line Inserted** at position 1`.
- **Pass criteria:** Subsequent `getLine 1` returns the inserted text.
- **Risk:** Writes to disk. Reversible via VCS.

#### TC-LW-063: `wb_script_editor` action=setLine (skip by default)
- **Note:** Same risk profile as TC-LW-062.

#### TC-LW-064: `wb_script_editor` action=removeLine (skip by default)
- **Note:** Same risk profile as TC-LW-062.

### Localization cluster (5 actions)

#### TC-LW-065: `wb_localization` action=listLanguages
- **Setup:** A localization file open in the Localization Editor.
- **Input:** `{ "action": "listLanguages" }`
- **Expected:** `**Language Columns** (N)` listing detected columns (e.g., `en_us`, `de`, `fr`...).
- **Pass criteria:** At least one language returned.
- **Risk:** None.

#### TC-LW-066: `wb_localization` action=getTable
- **Setup:** Localization file open.
- **Input:** `{ "action": "getTable" }`
- **Expected:** Markdown table with `ID | en_us | Target` columns.
- **Pass criteria:** Response is a parseable markdown table.
- **Risk:** None.

#### TC-LW-067: `wb_localization` action=insert (skip by default)
- **Note:** Mutates a localization file. Skip unless a dedicated test file is set up.

#### TC-LW-068: `wb_localization` action=modify (skip by default)
- **Note:** Same.

#### TC-LW-069: `wb_localization` action=delete (skip by default)
- **Note:** Same.

### Projects cluster (3 actions)

#### TC-LW-070: `wb_projects` action=list
- **Input:** `{ "action": "list" }`
- **Expected:** `**Loaded Projects** (N)` listing at least `ArmaReforger` + `Test1` (and any deps like `GameLib`, etc.).
- **Pass criteria:** Test1 appears with a path; project count >= 2.
- **Risk:** None.

#### TC-LW-071: `wb_projects` action=locate
- **Input:** `{ "action": "locate", "name": "Test1" }`
- **Expected:** `**Project Located**` with `Path:` populated.
- **Pass criteria:** Path is a real on-disk location.
- **Risk:** None.

#### TC-LW-072: `wb_projects` action=open
- **Input:** `{ "action": "open", "name": "<path-to-some-gproj>" }`
- **Expected:** `**Project Opened**`.
- **Pass criteria:** Subsequent `wb_projects action=list` shows the newly-opened project.
- **Risk:** Depending on Workbench's project model, this might be redundant if Test1 is already loaded. **Recommended skip** unless testing a second project — to avoid changing the test bed.

### Validate cluster

#### TC-LW-073: `wb_validate` action=material on a known-good material
- **Input:** `{ "action": "material", "path": "Materials/<some-known-good.emat>" }`
- **Expected:** `**Material Validation Passed**`.
- **Pass criteria:** `valid: true`, no errors.
- **Risk:** None.

#### TC-LW-074: `wb_validate` action=texture on a known-good texture
- **Input:** `{ "action": "texture", "path": "Textures/<some-known-good.edds>" }`
- **Expected:** `**Texture Validation Passed**`.
- **Pass criteria:** `valid: true`.
- **Risk:** None.

#### TC-LW-075: `wb_validate` material that doesn't exist
- **Input:** `{ "action": "material", "path": "Materials/Does/Not/Exist.emat" }`
- **Expected:** Error or `Material Validation Failed` with diagnostic.
- **Pass criteria:** `isError: true` or `valid: false`.
- **Risk:** None.

### Knowledge cluster (1 tool)

#### TC-LW-076: `wb_knowledge` query=index
- **Input:** `{ "query": "index" }`
- **Expected:** Lists all available KB topics from `data/kb/index.json`.
- **Pass criteria:** Response includes "Patterns" or topic names; non-empty.
- **Risk:** None — offline read.

#### TC-LW-077: `wb_knowledge` topic search (spawn-related)
- **Input:** `{ "query": "spawn point setup", "max_files": 2 }`
- **Expected:** Returns 1-2 markdown pattern files — likely `conflict-scenario-setup.md` or `scenario-framework.md`.
- **Pass criteria:** Response contains relevant content matching the query.
- **Risk:** None.

### Entity cluster

#### TC-LW-078: `wb_entity_list` baseline (no filter)
- **Input:** `{ "offset": 0, "limit": 50 }`
- **Expected:** Lists the first 50 entities of 173000+; pagination footer says "more entities not shown".
- **Pass criteria:** `total` > 100000; `entities` array has 50 items.
- **Risk:** None.

#### TC-LW-079: `wb_entity_list` with offset
- **Input:** `{ "offset": 100, "limit": 25 }`
- **Expected:** Next 25 entities starting at index 100.
- **Pass criteria:** `offset: 100`; 25 items.
- **Risk:** None.

#### TC-LW-080: `wb_entity_list` with nameFilter (known top-level-only behavior)
- **Input:** `{ "offset": 0, "limit": 50, "nameFilter": "EMCP_" }`
- **Expected:** Returns only top-level entities matching the substring `EMCP_` (case-insensitive). Per prior exploration, `nameFilter` does NOT recurse into children — only top-level entities are scanned.
- **Pass criteria:** All returned entities have `EMCP_` in their name; entities nested under groups are NOT returned even if their names match.
- **Risk:** None — documents known limitation.

#### TC-LW-081: `wb_entity_create` basic (path-only, base SpawnPoint)
- **Setup:** `default/EMCP_Test_Spawn` active.
- **Input:** `{ "prefab": "{E7F4D5562F48DDE4}Prefabs/MP/Spawning/SpawnPoint_Base.et", "position": "2200 40 2050", "name": "EMCP_Spawn_Base_01" }`
- **Expected:** `**Entity Created**` with name, prefab, position, layer.
- **Pass criteria:** Entity appears in `wb_entity_list nameFilter=EMCP_Spawn_Base_01`; position matches.
- **Risk:** Adds an entity. Cleanup via TC-LW-037 (layer delete).

#### TC-LW-082: `wb_entity_create` with rotation
- **Input:** `{ "prefab": "{E7F4D5562F48DDE4}Prefabs/MP/Spawning/SpawnPoint_Base.et", "position": "2210 40 2050", "rotation": "0 90 0", "name": "EMCP_Spawn_Base_Rot" }`
- **Expected:** Entity created with yaw 90°.
- **Pass criteria:** `wb_entity_modify name=EMCP_Spawn_Base_Rot action=getWorldTransform` returns rotation containing `90`.
- **Risk:** Adds an entity.

#### TC-LW-083: `wb_entity_create` while in play mode (guard test)
- **Setup:** Play mode (TC-LW-014 step 1).
- **Input:** `{ "prefab": "...SpawnPoint_Base.et", "position": "0 0 0", "name": "EMCP_NoCreate" }`
- **Expected:** `Cannot create entity while in play mode...`
- **Pass criteria:** Error; no entity created.
- **Risk:** None.

#### TC-LW-084: `wb_entity_create` invalid prefab
- **Input:** `{ "prefab": "{0000000000000000}Prefabs/Does/Not/Exist.et", "name": "EMCP_BadCreate" }`
- **Expected:** Error or null result; no entity created.
- **Pass criteria:** `isError: true` or response indicates failure.
- **Risk:** None.

#### TC-LW-085: `wb_entity_inspect` by name
- **Setup:** TC-LW-081 ran.
- **Input:** `{ "name": "EMCP_Spawn_Base_01" }`
- **Expected:** Markdown details: Name, Prefab, Class, Position, Rotation, Layer, Components (with class names).
- **Pass criteria:** `components` array includes `SCR_SpawnPoint` or equivalent.
- **Risk:** None.

#### TC-LW-086: `wb_entity_inspect` by index
- **Input:** `{ "index": 0 }`
- **Expected:** Returns the entity at index 0 of the entity list.
- **Pass criteria:** Same format as TC-LW-085.
- **Risk:** None.

#### TC-LW-087: `wb_entity_inspect` missing identifier
- **Input:** `{}`
- **Expected:** `Error: Provide either name or index to identify the entity.`
- **Pass criteria:** `isError: true`.
- **Risk:** None.

#### TC-LW-088: `wb_entity_inspect` non-existent name
- **Input:** `{ "name": "EMCP_DoesNotExist_xyz" }`
- **Expected:** Error from handler indicating entity not found.
- **Pass criteria:** Either `isError: true` OR a structured response with null/empty fields. Not a crash.
- **Risk:** None.

#### TC-LW-089: `wb_entity_select` action=select
- **Setup:** TC-LW-081 ran.
- **Input:** `{ "action": "select", "name": "EMCP_Spawn_Base_01" }`
- **Expected:** `**Selected: EMCP_Spawn_Base_01**`.
- **Pass criteria:** Subsequent `getSelected` shows this entity.
- **Risk:** None.

#### TC-LW-090: `wb_entity_select` action=getSelected
- **Setup:** TC-LW-089 ran.
- **Input:** `{ "action": "getSelected" }`
- **Expected:** `**Selected Entities**` lists `EMCP_Spawn_Base_01`.
- **Pass criteria:** Array contains the expected name.
- **Risk:** None.

#### TC-LW-091: `wb_entity_select` action=deselect
- **Setup:** TC-LW-089 ran.
- **Input:** `{ "action": "deselect", "name": "EMCP_Spawn_Base_01" }`
- **Expected:** `**Deselected: EMCP_Spawn_Base_01**`.
- **Pass criteria:** `getSelected` returns empty.
- **Risk:** None.

#### TC-LW-092: `wb_entity_select` action=clear
- **Setup:** Select 2+ entities first.
- **Input:** `{ "action": "clear" }`
- **Expected:** `**Selection cleared**`.
- **Pass criteria:** `getSelected` returns "No entities selected".
- **Risk:** None.

#### TC-LW-093: `wb_entity_modify` action=move
- **Setup:** TC-LW-081 ran.
- **Input:** `{ "name": "EMCP_Spawn_Base_01", "action": "move", "value": "2250 40 2050" }`
- **Expected:** `Moved to 2250 40 2050`.
- **Pass criteria:** `wb_entity_modify action=getWorldTransform` returns position `2250 40 2050`.
- **Risk:** None beyond entity move.

#### TC-LW-094: `wb_entity_modify` action=rotate
- **Setup:** TC-LW-081 ran.
- **Input:** `{ "name": "EMCP_Spawn_Base_01", "action": "rotate", "value": "0 45 0" }`
- **Expected:** `Rotated to 0 45 0`.
- **Pass criteria:** `getWorldTransform` returns rotation containing `45`.
- **Risk:** None.

#### TC-LW-095: `wb_entity_modify` action=rename
- **Setup:** TC-LW-081 ran.
- **Input:** `{ "name": "EMCP_Spawn_Base_01", "action": "rename", "value": "EMCP_Spawn_Base_01_renamed" }`
- **Expected:** `Renamed to "EMCP_Spawn_Base_01_renamed"`.
- **Pass criteria:** `wb_entity_list nameFilter=EMCP_Spawn_Base_01_renamed` finds the entity; old name no longer in list.
- **Risk:** Subsequent TCs must use the new name. Pair with rename-back to keep MUST-* tests reusable.

#### TC-LW-096: `wb_entity_modify` action=rename back
- **Input:** `{ "name": "EMCP_Spawn_Base_01_renamed", "action": "rename", "value": "EMCP_Spawn_Base_01" }`
- **Pass criteria:** Original name restored.
- **Risk:** None.

#### TC-LW-097: `wb_entity_modify` action=getWorldTransform
- **Setup:** Entity exists.
- **Input:** `{ "name": "EMCP_Spawn_Base_01", "action": "getWorldTransform" }`
- **Expected:** `**Transform: EMCP_Spawn_Base_01**` with `Position:` and `Rotation:` lines.
- **Pass criteria:** Both lines populated with `x y z` strings.
- **Risk:** None.

#### TC-LW-098: `wb_entity_modify` action=listProperties (whole entity)
- **Input:** `{ "name": "EMCP_Spawn_Base_01", "action": "listProperties" }`
- **Expected:** Markdown table of top-level entity props (position, rotation, coords, etc).
- **Pass criteria:** Table has rows; includes at least `position` and `rotation`.
- **Risk:** None.

#### TC-LW-099: `wb_entity_modify` action=listProperties of a component
- **Input:** `{ "name": "EMCP_Spawn_Base_01", "action": "listProperties", "propertyPath": "SCR_SpawnPoint" }`
- **Expected:** Markdown table of `SCR_SpawnPoint` component props (m_sFaction, m_fRespawnTime, m_bEnabled, etc).
- **Pass criteria:** Table includes `m_sFaction`.
- **Risk:** None.

#### TC-LW-100: `wb_entity_modify` action=getProperty
- **Input:** `{ "name": "EMCP_Spawn_Base_01", "action": "getProperty", "propertyPath": "SCR_SpawnPoint", "propertyKey": "m_sFaction" }`
- **Expected:** Response shows the current value of `m_sFaction` (likely empty/null on the bare Base prefab).
- **Pass criteria:** Tool returns a value (possibly empty string); no error.
- **Risk:** None.

#### TC-LW-101: `wb_entity_modify` action=setProperty (faction key)
- **Input:** `{ "name": "EMCP_Spawn_Base_01", "action": "setProperty", "propertyPath": "SCR_SpawnPoint", "propertyKey": "m_sFaction", "value": "US" }`
- **Expected:** `Set SCR_SpawnPoint = US`.
- **Pass criteria:** Subsequent `getProperty` returns `"US"`.
- **Risk:** Mutates the entity. Reversible via undo or setProperty back to empty.

#### TC-LW-102: `wb_entity_modify` action=clearProperty
- **Setup:** TC-LW-101 ran.
- **Input:** `{ "name": "EMCP_Spawn_Base_01", "action": "clearProperty", "propertyPath": "SCR_SpawnPoint", "propertyKey": "m_sFaction" }`
- **Expected:** `Cleared SCR_SpawnPoint`.
- **Pass criteria:** `getProperty` returns the default (empty).
- **Risk:** None.

#### TC-LW-103: `wb_entity_modify` action=makeVisible (scroll-to)
- **Input:** `{ "name": "EMCP_Spawn_Base_01", "action": "makeVisible" }`
- **Expected:** `Scrolled to EMCP_Spawn_Base_01`. UI side-effect: hierarchy panel scrolls.
- **Pass criteria:** No error; visual verification optional.
- **Risk:** None.

#### TC-LW-104: `wb_entity_modify` action=reparent
- **Setup:** Two entities exist; one will be parent.
- **Input:** `{ "name": "EMCP_Spawn_Base_01", "action": "reparent", "value": "<parent-entity-name>" }`
- **Expected:** `Reparented to "<parent>"`.
- **Pass criteria:** `wb_entity_inspect` shows `parentName: <parent>`.
- **Risk:** Changes hierarchy. Reversible via reparent back.

#### TC-LW-105: `wb_entity_modify` action=listArrayItems
- **Setup:** Entity has a component with an array-of-objects property (e.g., a faction-affiliation component with multiple outfit entries, or a slot with multiple actions).
- **Input:** `{ "name": "<entity>", "action": "listArrayItems", "propertyPath": "<component>", "propertyKey": "<array-prop>" }`
- **Expected:** List of items with class names and indices.
- **Pass criteria:** Array of items returned; each item has a class name.
- **Risk:** None.

#### TC-LW-106: `wb_entity_modify` action=addArrayItem
- **Setup:** Same array as TC-LW-105.
- **Input:** `{ "name": "<entity>", "action": "addArrayItem", "propertyPath": "<component>", "propertyKey": "<array-prop>", "value": "<item-class-name>", "memberIndex": -1 }`
- **Expected:** `Added '<item-class>' to '<array-prop>' at index -1`.
- **Pass criteria:** `listArrayItems` afterward shows N+1 items.
- **Risk:** Mutates the component. Reversible via removeArrayItem.

#### TC-LW-107: `wb_entity_modify` action=removeArrayItem
- **Setup:** TC-LW-106 ran.
- **Input:** `{ "name": "<entity>", "action": "removeArrayItem", "propertyKey": "<array-prop>", "memberIndex": <last-index> }`
- **Expected:** `Removed index <N> from '<array-prop>'`.
- **Pass criteria:** `listArrayItems` shows N items.
- **Risk:** None.

#### TC-LW-108: `wb_entity_modify` action=setObjectClass
- **Setup:** Entity has a polymorphic property (e.g., a `m_RespawnHandler` slot that accepts multiple subclasses).
- **Input:** `{ "name": "<entity>", "action": "setObjectClass", "propertyKey": "<polymorphic-prop>", "value": "<new-class>" }`
- **Expected:** `Changed class of '<prop>' to '<new-class>'`.
- **Pass criteria:** Subsequent `getProperty` reports the new class.
- **Risk:** Mutates the component.

#### TC-LW-109: `wb_entity_modify` missing required value
- **Input:** `{ "name": "EMCP_Spawn_Base_01", "action": "move" }` (no value)
- **Expected:** `Error: "value" parameter is required for the "move" action.`
- **Pass criteria:** `isError: true`.
- **Risk:** None.

#### TC-LW-110: `wb_entity_delete`
- **Setup:** Entity exists.
- **Input:** `{ "name": "EMCP_Spawn_Base_Rot" }`
- **Expected:** `**Entity Deleted**\n\nRemoved entity: EMCP_Spawn_Base_Rot`.
- **Pass criteria:** Subsequent `wb_entity_list nameFilter=EMCP_Spawn_Base_Rot` returns 0.
- **Risk:** Removes entity. Used at cleanup.

#### TC-LW-111: `wb_entity_delete` in play mode (guard test)
- **Setup:** Play mode.
- **Input:** `{ "name": "EMCP_Spawn_Base_01" }`
- **Expected:** `Cannot delete entity while in play mode...`
- **Pass criteria:** No deletion.
- **Risk:** None.

#### TC-LW-112: `wb_entity_duplicate` save as new prefab in mod
- **Setup:** A base-game prefab is placed in the scene (e.g., `EMCP_Spawn_Base_01`).
- **Input:** `{ "entityName": "EMCP_Spawn_Base_01", "destPath": "Prefabs/EMCP_Test/EMCP_Spawn_Base_01_dup.et", "modName": "Test1", "replaceInScene": false }`
- **Expected:** `**Prefab saved successfully**` listing source, dest path, new GUID.
- **Pass criteria:** File exists at `<Test1>/Prefabs/EMCP_Test/EMCP_Spawn_Base_01_dup.et`; `.meta` sidecar exists; GUID parseable.
- **Risk:** Creates files. Cleanup via filesystem delete.

#### TC-LW-113: `wb_entity_duplicate` with replaceInScene=true
- **Setup:** A new placed entity (don't use EMCP_Spawn_Base_01 — pick a fresh one).
- **Input:** `{ "entityName": "EMCP_Duplicate_Donor", "destPath": "Prefabs/EMCP_Test/EMCP_Donor_Replaced.et", "modName": "Test1", "replaceInScene": true }`
- **Expected:** `**Entity duplicated successfully**`. Original gone, replacement placed at same position with `_copy` suffix.
- **Pass criteria:** `wb_entity_list nameFilter=EMCP_Duplicate_Donor` returns 0 (deleted); `wb_entity_list nameFilter=EMCP_Duplicate_Donor_copy` returns 1.
- **Risk:** Creates a file + replaces scene entity. Reversible but heavy.

### Component cluster (3 actions)

#### TC-LW-114: `wb_component` action=list
- **Setup:** Entity exists.
- **Input:** `{ "entityName": "EMCP_Spawn_Base_01", "action": "list" }`
- **Expected:** `**Components on EMCP_Spawn_Base_01** (N)` listing each component class.
- **Pass criteria:** Includes `SCR_SpawnPoint` or `SCR_Position`.
- **Risk:** None.

#### TC-LW-115: `wb_component` action=add
- **Setup:** Entity exists; pick a component class that's safe to add (e.g., `MeshObject` won't help on a spawn point — use a safe testbed entity).
- **Input:** `{ "entityName": "EMCP_Spawn_Base_01", "action": "add", "componentClass": "SignalsManagerComponent" }`
- **Expected:** `**Component Added**`.
- **Pass criteria:** `action=list` afterward shows the new component.
- **Risk:** Modifies entity structure. Reversible via remove.

#### TC-LW-116: `wb_component` action=remove
- **Setup:** TC-LW-115 ran.
- **Input:** `{ "entityName": "EMCP_Spawn_Base_01", "action": "remove", "componentClass": "SignalsManagerComponent" }`
- **Expected:** `**Component Removed**`.
- **Pass criteria:** `action=list` no longer shows it.
- **Risk:** None.

#### TC-LW-117: `wb_component` action=add missing componentClass
- **Input:** `{ "entityName": "EMCP_Spawn_Base_01", "action": "add" }`
- **Expected:** `Error: componentClass is required for the "add" action.`
- **Pass criteria:** `isError: true`.
- **Risk:** None.

### Headless CLI cluster (script validation + build data)

#### TC-LW-118: `wb_validate_scripts` PC config
- **Input:** `{ "gproj_path": "<absolute-path-to-Test1.gproj>", "config": "PC", "timeout_seconds": 180 }`
- **Expected:** Spawns headless workbench, exits with code 0 (or non-zero if real errors). Returns `## wb_validate_scripts:` markdown with exit code, duration, error/deprecation lists.
- **Pass criteria:** Exit code reported; markdown contains either "Clean validation" or an error count.
- **Risk:** Spawns a Workbench subprocess — heavy (~30-90s).

#### TC-LW-119: `wb_validate_scripts` HEADLESS config
- **Input:** `{ "gproj_path": "<Test1.gproj>", "config": "HEADLESS", "timeout_seconds": 180 }`
- **Expected:** Same as TC-LW-118 but server-side compile.
- **Pass criteria:** Same.
- **Risk:** Same.

#### TC-LW-120: `wb_validate_scripts` invalid gproj path (flag-smuggle guard)
- **Input:** `{ "gproj_path": "-malicious-flag", "config": "PC" }`
- **Expected:** `Invalid gproj_path: must not start with '-' or contain NULL bytes...`
- **Pass criteria:** `isError: true`; no subprocess spawned.
- **Risk:** None — verifies security guard.

#### TC-LW-121: `wb_validate_scripts` nonexistent gproj
- **Input:** `{ "gproj_path": "C:/Does/Not/Exist.gproj", "config": "PC" }`
- **Expected:** `.gproj not found: <resolved-path>`.
- **Pass criteria:** `isError: true`.
- **Risk:** None.

#### TC-LW-122: `wb_cli_run` command=openProject
- **Input:** `{ "command": "openProject", "target": "<Test1.gproj>", "timeout_seconds": 60 }`
- **Expected:** Workbench subprocess opens with project loaded. Returns exit code + tail of output.
- **Pass criteria:** Exit code 0 (or non-zero if Workbench exits unexpectedly — capture in report).
- **Risk:** Spawns a second Workbench process. **Recommended skip** when the main Workbench is already running to avoid contention.

#### TC-LW-123: `wb_cli_run` command=buildScripts
- **Input:** `{ "command": "buildScripts", "target": "<Test1.gproj>", "config": "PC", "timeout_seconds": 180 }`
- **Expected:** Headless build runs, exit code reported.
- **Pass criteria:** Exit code reported.
- **Risk:** Heavy. Skip if not needed.

#### TC-LW-124: `wb_cli_run` flag-smuggle guard
- **Input:** `{ "command": "openProject", "target": "-evil" }`
- **Expected:** `Invalid target: must not start with '-' or contain NULL bytes...`
- **Pass criteria:** `isError: true`.
- **Risk:** None.

#### TC-LW-125: `wb_cli_run` target not on disk
- **Input:** `{ "command": "openProject", "target": "C:/Does/Not/Exist.gproj" }`
- **Expected:** `Target not found on disk: <path>`.
- **Pass criteria:** `isError: true`.
- **Risk:** None.

#### TC-LW-126: `wb_cli_run` command=navmeshGenerate (HEAVY — skip by default)
- **Note:** Generates navmesh; takes 5-15 min. Skip unless explicitly testing the navmesh pipeline. The TC verifies the command plan composes correctly; behavior verified offline via `cli-runner` unit tests.

#### TC-LW-127: `wb_cli_run` command=forceSaveAll (HEAVY — skip by default)
- **Note:** Bulk-resaves a world. Heavy and irreversible. Skip.

#### TC-LW-128: `wb_build_data` PC platform
- **Input:** `{ "gproj_path": "<Test1.gproj>", "out_dir": "<temp>/EMCP_BuildData_PC", "platform": "PC", "timeout_seconds": 600 }`
- **Expected:** Builds `.pak` output to `out_dir`. Reports exit code + last 40 lines of stdout.
- **Pass criteria:** Exit code 0; `out_dir` contains `*.pak` files; "Build complete" emitted.
- **Risk:** Heavy (1-10 min). Skip by default; run as full release smoke.

#### TC-LW-129: `wb_build_data` flag-smuggle guard
- **Input:** `{ "gproj_path": "-evil", "out_dir": "x", "platform": "PC" }`
- **Expected:** `Path may not start with '-'...`
- **Pass criteria:** `isError: true`.
- **Risk:** None.

#### TC-LW-130: `wb_build_data` out_dir can't be created
- **Input:** `{ "gproj_path": "<Test1.gproj>", "out_dir": "Z:/nonexistent/forbidden/path", "platform": "PC" }`
- **Expected:** `Cannot create out_dir...`
- **Pass criteria:** `isError: true`; no Workbench subprocess spawned.
- **Risk:** None.

## MUST-test cases

These are the highest-value tests — full scenario coverage matching the user's stated priorities. Each is composed of multiple wb_* tools.

### TC-MUST-1: BLUFOR spawn area
- **Goal:** Create a "BLUFOR_Spawn" layer, place a US-affiliated spawn point, verify faction via property inspection.
- **Setup:**
  - Workbench in edit mode (`wb_state`).
  - No layer `default/BLUFOR_Spawn` yet (delete it first if leftover).
- **Steps:**
  1. **Create layer** — `wb_layers` `{ "action": "create", "name": "BLUFOR_Spawn", "parentPath": "default" }`. Expect `Layer Updated` with `Created layer "BLUFOR_Spawn" under default`.
  2. **Set active** — `wb_layers` `{ "action": "setActive", "layerPath": "default/BLUFOR_Spawn" }`. Expect `Set active layer to "default/BLUFOR_Spawn"`.
  3. **Verify active** — `wb_layers` `{ "action": "list" }`. Expect `default/BLUFOR_Spawn [ACTIVE]`.
  4. **Spawn the spawn point** — `wb_entity_create` `{ "prefab": "{E7F4D5562F48DDE4}Prefabs/MP/Spawning/SpawnPoint_Base.et", "position": "2200 40 2050", "rotation": "0 0 0", "name": "BLUFOR_US_SpawnPoint_01" }`. Expect `**Entity Created**`.
     - **Fallback A:** If GUID-prefixed path fails, retry with bare path `Prefabs/MP/Spawning/SpawnPoint_Base.et`.
     - **Fallback B:** If `SpawnPoint_Base.et` is too generic, try the path-only `Prefabs/MP/Spawning/SpawnPoint_US.et` which is pre-set to US (no setProperty needed — but document if the path fails to resolve since we don't have its GUID).
  5. **Verify placement** — `wb_entity_inspect` `{ "name": "BLUFOR_US_SpawnPoint_01" }`. Expect `Class: SCR_SpawnPoint` (or a subclass like `SCR_CampaignSpawnPoint`), `Position: 2200 40 2050`, components include `SCR_SpawnPoint`.
  6. **Read current faction key (baseline)** — `wb_entity_modify` `{ "name": "BLUFOR_US_SpawnPoint_01", "action": "getProperty", "propertyPath": "SCR_SpawnPoint", "propertyKey": "m_sFaction" }`. Expect either empty or the default per the prefab. Record value.
  7. **Set faction to US** — `wb_entity_modify` `{ "name": "BLUFOR_US_SpawnPoint_01", "action": "setProperty", "propertyPath": "SCR_SpawnPoint", "propertyKey": "m_sFaction", "value": "US" }`. Expect `Set SCR_SpawnPoint = US`.
  8. **Verify new value** — `wb_entity_modify` `{ "name": "BLUFOR_US_SpawnPoint_01", "action": "getProperty", "propertyPath": "SCR_SpawnPoint", "propertyKey": "m_sFaction" }`. Expect `"US"`.
  9. **List properties for documentation** — `wb_entity_modify` `{ "name": "BLUFOR_US_SpawnPoint_01", "action": "listProperties", "propertyPath": "SCR_SpawnPoint" }`. Expect table listing `m_sFaction`, `m_fRespawnTime`, `m_bEnabled`, `m_bIsVisibleForPlayers`, etc. Record all property names for reference.
- **Expected:** Layer created, spawn point placed in correct layer, faction set to US, inspect + getProperty round-trip succeeds.
- **Pass criteria:** All 9 steps succeed without `isError: true`. Final value of `m_sFaction` equals `"US"`.
- **Verifies tools:** `wb_layers` (create, setActive, list — 3 actions), `wb_entity_create`, `wb_entity_inspect`, `wb_entity_modify` (getProperty, setProperty, listProperties — 3 actions).
- **Risk callouts:**
  - SpawnPoint_Base GUID `E7F4D5562F48DDE4` is sourced from `data/kb/patterns/GameModes_And_Scenarios/conflict-scenario-setup.md:578`. **Verified against the KB.** If Workbench rejects this GUID, the KB is stale.
  - The exact property name for the faction key on the SCR_SpawnPoint may differ from `m_sFaction` in newer Workbench versions. If `getProperty` returns "(property not found)", first run `listProperties propertyPath=SCR_SpawnPoint` to enumerate the actual prop names, then retry with the correct key.
  - `SpawnPoint_US.et` path is documented but its GUID is NOT in our KB. Fallback B documents the gap.
- **Cleanup:** Run TC-LW-110 `wb_entity_delete name=BLUFOR_US_SpawnPoint_01`, then `wb_layers action=delete layerPath=default/BLUFOR_Spawn`.

### TC-MUST-2: Modify unit attributes (position, rotation, name, faction, rank)
- **Goal:** Verify all 5 attribute mutations on a US Rifleman entity.
- **Setup:**
  - Either reuse one of the prior session's `US_Rifleman_01..08` entities, or spawn a new one with `wb_entity_create` and a US character prefab.
  - Pick a soldier prefab — recommend `{2F912ED6E399FF47}Prefabs/Characters/Factions/BLUFOR/US_Army/Character_US_Unarmed.et` (verified GUID in KB).
- **Steps:**
  1. **Spawn fresh test target** — `wb_entity_create` `{ "prefab": "{2F912ED6E399FF47}Prefabs/Characters/Factions/BLUFOR/US_Army/Character_US_Unarmed.et", "position": "2200 40 2060", "name": "EMCP_Unit_Test", "layerPath": "default/BLUFOR_Spawn" }`. Expect `**Entity Created**`.
  2. **Read baseline transform** — `wb_entity_modify action=getWorldTransform name=EMCP_Unit_Test`. Record current pos + rot.
  3. **Move (position)** — `wb_entity_modify` `{ "name": "EMCP_Unit_Test", "action": "move", "value": "2210 40 2065" }`. Verify via `getWorldTransform` — position changed.
  4. **Rotate** — `wb_entity_modify` `{ "name": "EMCP_Unit_Test", "action": "rotate", "value": "0 180 0" }`. Verify via `getWorldTransform` — rotation contains `180`.
  5. **Rename** — `wb_entity_modify` `{ "name": "EMCP_Unit_Test", "action": "rename", "value": "EMCP_Unit_Renamed" }`. Verify: `wb_entity_list nameFilter=EMCP_Unit_Renamed` returns 1; `wb_entity_list nameFilter=EMCP_Unit_Test` returns 0.
  6. **Inspect components** — `wb_entity_inspect name=EMCP_Unit_Renamed`. Look for `SCR_CharacterFactionAffiliationComponent` and `SCR_CharacterRankComponent` in the components list. Record their indices.
  7. **List faction-affiliation props** — `wb_entity_modify` `{ "name": "EMCP_Unit_Renamed", "action": "listProperties", "propertyPath": "SCR_CharacterFactionAffiliationComponent" }`. **Critical step** — identifies the actual editable faction-key property (could be `m_DefaultFactionKey`, `m_sAffiliatedFactionKey`, or something else; the API exposes `SetAffiliatedFactionByKey` as a method but the serialized prop name needs discovery via listProperties).
  8. **Read current faction key** — `wb_entity_modify action=getProperty propertyPath=SCR_CharacterFactionAffiliationComponent propertyKey=<discovered-key>`. Record.
  9. **Set faction to US** — `wb_entity_modify` `{ "name": "EMCP_Unit_Renamed", "action": "setProperty", "propertyPath": "SCR_CharacterFactionAffiliationComponent", "propertyKey": "<discovered-key>", "value": "US" }`.
  10. **Verify new faction** — re-run step 8. Expect `"US"`.
  11. **List rank-component props** — `wb_entity_modify` `{ "name": "EMCP_Unit_Renamed", "action": "listProperties", "propertyPath": "SCR_CharacterRankComponent" }`. Identify the rank prop name (likely `m_eRank`, `m_iRank`, or `m_eCharacterRank` — the API uses `SCR_ECharacterRank` enum).
  12. **Read current rank** — `wb_entity_modify action=getProperty propertyPath=SCR_CharacterRankComponent propertyKey=<discovered-rank-key>`.
  13. **Set rank to PRIVATE** (or whatever the enum's first value is — `SCR_ECharacterRank` per API) — `wb_entity_modify action=setProperty propertyPath=SCR_CharacterRankComponent propertyKey=<discovered-rank-key> value=PRIVATE` (or `0` if it's an integer-backed enum).
  14. **Verify new rank** — re-run step 12. Expect the new value.
- **Expected:** All 5 attributes (position, rotation, name, faction, rank) successfully mutate and round-trip.
- **Pass criteria:** Each setProperty's matching getProperty returns the new value. No `isError: true` on any step.
- **Verifies tools:** `wb_entity_create`, `wb_entity_modify` (move, rotate, rename, listProperties, getProperty, setProperty, getWorldTransform — 7 actions), `wb_entity_inspect`, `wb_entity_list` (nameFilter).
- **Risk callouts:**
  - **Property name discovery is the critical step.** Setting `m_sFactionKey` blindly (the brief's suggested name) may fail because the serialized property name from inspector may differ. Step 7's `listProperties` is the single source of truth.
  - The rank enum value format (numeric vs symbolic) is determined by the EMCP_WB_ModifyEntity handler's serialization. Try the symbolic name first (`PRIVATE`, `SERGEANT`, etc.); fall back to numeric.
  - If `SCR_CharacterFactionAffiliationComponent` listProperties returns empty, the component isn't on the entity — switch to base `FactionAffiliationComponent` (the parent class).
- **Cleanup:** `wb_entity_delete name=EMCP_Unit_Renamed`.

### TC-MUST-3: Arsenal placement and configuration
- **Goal:** Spawn an arsenal entity, verify it's placeable, document its exposed properties.
- **Setup:** Edit mode, `default/BLUFOR_Spawn` layer active (or any test layer).
- **Steps:**
  1. **Resolve arsenal GUID** — `wb_prefabs action=getGuid templatePath=Prefabs/Props/Military/Arsenal/ArsenalBoxes/US/ArsenalBox_US.et`. If returns a GUID, use it; if returns "(not found)", proceed with bare path (known regression).
  2. **Spawn arsenal** — `wb_entity_create` `{ "prefab": "<guid-or-path>Prefabs/Props/Military/Arsenal/ArsenalBoxes/US/ArsenalBox_US.et", "position": "2205 40 2055", "name": "EMCP_Arsenal_US_01", "layerPath": "default/BLUFOR_Spawn" }`. Expect `**Entity Created**`.
     - **Fallback:** If `ArsenalBox_US.et` doesn't resolve, try the `AmmoBoxArsenal_Weapons_US.et` variant whose partial-GUID `{377EB906F591E4BA}` is in the KB.
  3. **Verify placement** — `wb_entity_inspect name=EMCP_Arsenal_US_01`. Expect Class to be a `SCR_ScenarioFrameworkSlot`-related or `EditorPlaceable`-related class, with components like `SCR_ArsenalComponent`, `SCR_BaseLoadoutManager`, or similar.
  4. **List entity components** — `wb_component action=list entityName=EMCP_Arsenal_US_01`. Document all component class names.
  5. **List entity-level properties** — `wb_entity_modify action=listProperties name=EMCP_Arsenal_US_01`.
  6. **List arsenal-component properties** — `wb_entity_modify action=listProperties name=EMCP_Arsenal_US_01 propertyPath=<arsenal-component-class>`. Document the configuration knobs (faction filter, allowed loadouts, item categories, etc.).
- **Expected:** Arsenal entity spawns and is inspectable.
- **Pass criteria:** Entity created without error; `wb_entity_inspect` returns a populated components list; `listProperties` returns a non-empty table for the arsenal component.
- **Verifies tools:** `wb_prefabs` (getGuid), `wb_entity_create`, `wb_entity_inspect`, `wb_component` (list), `wb_entity_modify` (listProperties).
- **Risk callouts:**
  - Arsenal GUIDs aren't in our KB. If `getGuid` fails AND bare path also fails to resolve in `wb_entity_create`, the test documents an additional gap (e.g., recommend running `project_index_status` to confirm the arsenal prefab is indexed at all).
  - The arsenal prefab path may be under `Prefabs/MP/Equipment/` or `Prefabs/Props/Military/Arsenal/` depending on the Reforger version. Both paths are in our wiki refs; try both.
- **Cleanup:** `wb_entity_delete name=EMCP_Arsenal_US_01`.

### TC-MUST-4: Loadout defining (two paths)
- **Goal:** Verify that loadouts can be defined either by (A) creating a loadout .conf, or (B) editing a soldier's BaseLoadoutManagerComponent / inventory storage.
- **Note:** `config_create`'s `configType` enum (from `src/templates/config.ts`) is **`"mission-header" | "faction" | "entity-catalog" | "editor-placeables"`**. **There is NO `"loadout"` configType.** This is a key finding for Path A.

#### Path A (config_create — INFEASIBLE as-is)
- **Step 1:** `config_create` `{ "configType": "loadout" }` — expect tool error: `configType` enum doesn't include `loadout`.
- **Pass criteria:** Tool rejects the configType with a Zod validation error listing the supported types.
- **Workaround:** Use `entity-catalog` configType to build a Loadout-equivalent (a catalog of loadout prefabs). Or create the `.conf` manually with the correct `SCR_BasePlayerLoadout` / `SCR_LoadoutAreaInfo` schema (no MCP support today).
- **Gap documented:** To fully test loadout config creation via MCP, the `ConfigType` enum in `src/templates/config.ts` would need a new `"loadout"` member with `rootType: "SCR_BasePlayerLoadout"` (or similar), and `buildLoadout()` builder. **This is a tool extension TC, not a runtime TC.**

#### Path B (modify soldier inventory components — runtime TC)
- **Setup:** Spawn a US character (use `EMCP_Unit_Renamed` from TC-MUST-2 if still present, or create a fresh one with the unarmed character prefab).
- **Steps:**
  1. **Inspect components** — `wb_entity_inspect name=EMCP_Unit_Renamed`. Look for `SCR_CharacterInventoryStorageComponent`, `BaseLoadoutManagerComponent`, or `SCR_PlayerLoadoutComponent`.
  2. **List components** — `wb_component action=list entityName=EMCP_Unit_Renamed`. Document indices.
  3. **List inventory-storage properties** — `wb_entity_modify action=listProperties propertyPath=SCR_CharacterInventoryStorageComponent name=EMCP_Unit_Renamed`. Look for array properties like `m_aStorages` or `m_aInitialItems`.
  4. **List array items** — for each array prop, `wb_entity_modify action=listArrayItems propertyKey=<array-prop> name=EMCP_Unit_Renamed`. Document the existing structure.
  5. **Add a loadout item** — `wb_entity_modify` `{ "name": "EMCP_Unit_Renamed", "action": "addArrayItem", "propertyKey": "<initial-items-array>", "value": "<weapon-prefab-path-or-class>", "memberIndex": -1 }`. Expect `Added '<class>' to '...' at index -1`.
  6. **Verify the addition** — re-run step 4. Expect N+1 items.
  7. **Set a property on the new item** — if step 5 added an object, drill into it: `wb_entity_modify action=setProperty propertyPath=<array-prop>.<index>.<sub-property> value=<...>`. The propertyPath syntax may differ — verify with listProperties first.
  8. **Remove the test item** — `wb_entity_modify action=removeArrayItem propertyKey=<array-prop> memberIndex=<N>`.
- **Expected:** Loadout-defining mutations work via array-item add/remove on the appropriate component.
- **Pass criteria:** Step 5's add round-trips (visible in step 6's list); step 8 removes it cleanly.
- **Verifies tools:** `wb_entity_inspect`, `wb_component` (list), `wb_entity_modify` (listProperties, listArrayItems, addArrayItem, removeArrayItem — 4 actions).
- **Risk callouts:**
  - The exact component name for inventory loadout varies by character class — could be `SCR_CharacterInventoryStorageComponent`, `BaseLoadoutManagerComponent`, `EquipmentStorageComponent`, etc. **Use step 2's component list as ground truth.**
  - Adding items to an inventory at world-edit time may not behave like loadout-config-driven inventory — the runtime SCR_LoadoutManager applies loadouts on spawn. A scene-time addition tests the editor capability but may not reflect actual gameplay loadout flow.
  - Item class names for `addArrayItem` need to match an inventory-storage item class (e.g., `SCR_InventoryStorageItem` or a subclass) — discoverable via `wb_knowledge query=inventory` or `api_search`.

## Tools/actions intentionally not covered (rationale)

| Tool / Action | Why not covered |
|---|---|
| `wb_validate_scripts` HEADLESS for an addon with intentional errors | Requires a malformed test fixture. TC-LW-118/119 cover the happy path; broken-script verification belongs in a separate fixture-driven test, not the live cluster. |
| `wb_cli_run` navmeshGenerate / forceSaveAll | Both heavy (5-15+ min). Documented as skip-by-default. |
| `wb_build_data` for non-PC platforms | Same heaviness; PC covers the path. |
| `wb_script_editor` mutating actions (setLine/insertLine/removeLine) | Mutates files. Skip unless a throwaway script fixture is set up — not part of the live-Workbench smoke. |
| `wb_localization` mutating actions | Mutates loc tables. Same reasoning. |
| `wb_resources` register/rebuild | Heavy + already exercised by `wb_entity_duplicate`. |
| `wb_clipboard` operations beyond basic round-trip | Diminishing returns; copy + paste + hasCopied cover the contract. |
| `wb_prefabs` save | Requires an open prefab in the editor with pending changes; setup is brittle for automated TCs. Best run as a paired manual + automated test. |
| `wb_play` / `wb_stop` deep tests | Mode round-trip already covered by TC-LW-014. Verifying play-mode behavior (e.g., script execution) belongs in a separate runtime-test cluster. |

## Suggested execution order (single session)

1. **Bring-up:** TC-LW-001, 002, 003, 004 (connection + state).
2. **Read-only smoke:** TC-LW-020, 021, 022, 023 (terrain), 076, 077 (knowledge), 078, 079, 080 (entity list), 070, 071 (projects).
3. **Layer setup:** TC-LW-024, 025, 026, 027, 028 (create + verify EMCP_Test_Spawn).
4. **MUST-1 (BLUFOR spawn area):** runs TC-MUST-1.
5. **MUST-2 (unit attributes):** runs TC-MUST-2.
6. **MUST-3 (arsenal):** runs TC-MUST-3.
7. **MUST-4 (loadout, Path A error + Path B mutate):** runs TC-MUST-4.
8. **Layer manipulation:** TC-LW-029 through TC-LW-036 (visibility, lock, rename round-trip).
9. **Entity manipulation:** TC-LW-081 through TC-LW-110 (create/modify/delete the full action grid). Many overlap with MUST tests — skip duplicates.
10. **Resources:** TC-LW-039, 040, 041, 042 (browse — known gap).
11. **Prefabs:** TC-LW-046, 047 (known gaps), 048 (stall — run LAST in this cluster).
12. **Components, clipboard, validate, script editor, localization:** as time permits.
13. **Headless CLI cluster:** TC-LW-118 through TC-LW-130 — run last (subprocess-heavy).
14. **Cleanup:** TC-LW-037 (delete EMCP_Test_Spawn layer), and TC-LW-014 (verify mode is back to edit if any play-mode TCs ran).
15. **Edge-case guards:** TC-LW-010, 012, 013, 023, 038, 075, 084, 087, 088, 109, 111, 117, 120, 124, 125, 129, 130 — run alongside their main TCs.

Mode-toggle TCs (TC-LW-014, 015, 016, 038, 045, 083, 111) cluster together — switch into play once, run all play-mode guards, switch out once.
