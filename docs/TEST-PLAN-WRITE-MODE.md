# Test plan — write-mode, refactor primitives, L7 EMCP bridge, server lifecycle

Scope: every MCP tool that mutates files, spawns processes, or calls into the live Workbench/Enforce handler bridge.

This plan is read alongside `docs/CONVENTIONS.md` (refactor doctrine) and `docs/L7-PLAN.md` (EMCP handler architecture). All tools live in `src/tools/`; canonical registration list is `src/server.ts` lines 90–117 and 358–389.

---

## 0. Conventions

### Test ID format

`TC-<group>-NNN`. Groups:

- `SCAFFOLD` — L1 file-creation
- `REFACTOR` — L5 mutation primitives (dry-run + sandboxed live)
- `SERVERCFG` — L3 server.json author/validate
- `WBCLI` — L3 Workbench-CLI wrappers
- `TERRAIN` — L7 EMCP terrain bridge
- `L8WRITE` — L8 scenario / faction write-mode
- `LIFECYCLE` — L8 server_launch / server_stop
- `PROMPT` — L8 mission_setup / character_anim_pipeline_guide

### Field schema (per test case)

Every test case follows the shape:

- **Input** — exact JSON args
- **Expected output** — success text shape, dry-run preview shape, error UX
- **Pass criteria** — concrete assertion (string substring match, file existence, exit code)
- **Test target** — file path / GUID / process expected to be touched
- **Side effects** — files written, processes spawned, sandboxed yes/no
- **Cleanup** — what to revert
- **Verifies** — primary code path
- **Risk** — what could go wrong
- **Time budget** — fast (<5s), medium (5–60s), slow (>60s)

### Test target — `Test1`

The user's live mod is `C:\Users\<you>\Documents\My Games\ArmaReforgerWorkbench\addons\Test1\`.
- `ID = Test1`
- `GUID = 6968F5564CA31D9D`
- Base game dep: `58D0FB3206B6F859`

**DO NOT** run mutating tests against Test1 directly. Use the sandbox path below.

### Sandbox setup (one-time, reused across all REFACTOR + L8WRITE tests)

```bash
# 1. Copy Test1 → Test1_sandbox
SRC="/c/Users/<you>/Documents/My Games/ArmaReforgerWorkbench/addons/Test1"
DST="/c/Users/<you>/Documents/My Games/ArmaReforgerWorkbench/addons/Test1_sandbox"
rm -rf "$DST"
cp -r "$SRC" "$DST"

# 2. git init the sandbox so the git-clean check has a clean baseline
cd "$DST"
git init
git add -A
git -c user.email=test@local -c user.name=test commit -m "sandbox baseline"

# 3. Re-rename the .gproj's ID + GUID so the project-index doesn't conflate
#    Test1 and Test1_sandbox. Manual edits (NOT via refactor_rename_project_id —
#    we test that tool later):
#    - In addon.gproj, change ID "Test1" → ID "Test1_sandbox"
#    - In addon.gproj, change GUID "6968F5564CA31D9D" → "6968F5564CA31D9E"
#      (last hex bumped 0xD → 0xE so the new GUID is unique but visually paired)
#    Commit:
git add addon.gproj
git -c user.email=test@local -c user.name=test commit -m "rename sandbox project id"

# 4. Restart the MCP server so the project-index re-crawls and picks up the
#    sandbox. Confirm via `project_index_status`:
#    Expect: "Test1_sandbox" appears in the projects list with GUID 6968F5564CA31D9E.
```

Teardown after a test batch:
```bash
rm -rf "$DST"
# Re-run project_index_status to confirm the sandbox row disappears.
```

The sandbox protects Test1 — every refactor that writes uses `project_root` / `gproj_path` pointing at `Test1_sandbox`.

### Refactor cleanup expectations (`.bak` sidecars)

Per `src/refactor/byte-edit.ts` doctrine:

- Every successful refactor write leaves `<path>.bak` next to the original.
- `atomicCommit` rolls back ALL files on partial failure — verify no `.bak` is left when rollback fires.
- `writeWithBackup` writes a `.bak` before overwriting any pre-existing dest.

After every live REFACTOR / L8WRITE test, the cleanup step grep's for `*.bak` under the sandbox and either restores from them (`mv x.bak x` to revert) or deletes them (if the test left the file in the desired post-state).

---

## 1. Tools where dry-run is NOT supported / dry-run-only at v1

Note before reading the cases: the actual API uses **`commit: boolean`** (default `false`) for the L5 refactor primitives, not `dry_run`. The user-facing semantics line up — `commit:false` ≡ dry-run — but the field name differs. L8 write-mode tools use `dry_run` directly.

| Tool | Dry-run support | Notes |
|---|---|---|
| `refactor_replace_guid` | Yes — `commit:false` default | |
| `refactor_move_resource_path` | Yes — `commit:false` default | Phase order on commit: ref edits first, rename last |
| `refactor_rename_project_id` | Yes — `commit:false` default | |
| `refactor_normalize_dependencies` | Yes — `commit:false` default | |
| `refactor_merge_duplicate_guids` | **Diagnose-only** at v1 | No `commit` field; tool only reports |
| `refactor_remove_unused` | **Dry-run only** at v1 | Returns a script for human review; no live-delete |
| `scenario_clone_area` | Yes — `dry_run:false` default (writes by default) | Tool's job is extraction; preview is opt-in |
| `scenario_apply_template` | Yes — `dry_run:true` default | Stamps into existing layer; preview-first is safer |
| `faction_create` | Yes — `dry_run:false` default | |
| `server_launch` | Yes — `dry_run:true` default | Spawn is opt-in |
| `server_stop` | **No dry-run** | Terminates process; idempotent (`not_running` on second call) |
| `mod` (action:create) | No (refuses if dir exists) | |
| `script_create` / `config_create` / `layout_create` / `prefab` create | No (refuses if file exists) | Returns rendered content + "not written" message |
| `scenario_create_conflict` | No (refuses if any file exists) | All-or-nothing rollback on partial write failure |
| `server_config` | No (refuses if file exists, unless `overwrite:true`) | |
| `game_duplicate` / `wb_entity_duplicate` | No | Refuses if dest exists |
| `terrain_inspect` / `terrain_navmesh_status` / `terrain_road_export_graph` | N/A (read-only on Enforce side) | |
| `wb_validate_scripts` / `wb_cli_run` / `wb_build_data` | N/A (read-only orchestration) | These spawn the CLI but don't mutate project files |

---

## 2. L1 scaffold (file-creation) tests

### TC-SCAFFOLD-001: mod create — bare scaffold

- **Input:**
  ```json
  { "action": "create", "name": "TC_BareMod",
    "projectPath": "C:/Users/<you>/Documents/My Games/ArmaReforgerWorkbench/addons" }
  ```
- **Expected output:** "## Addon Created: TC_BareMod" + list of created files including `TC_BareMod.gproj`. Directory tree with `Scripts/Game/`, `Prefabs/`, `Configs/`, etc.
- **Pass criteria:**
  - `addons/TC_BareMod/TC_BareMod.gproj` exists and parses (`GameProject` root, ID="TC_BareMod", non-empty GUID, `Dependencies { "58D0FB3206B6F859" }`).
  - All 9 expected dirs created.
- **Test target:** `addons/TC_BareMod/`
- **Side effects:** New addon directory tree.
- **Cleanup:** `rm -rf addons/TC_BareMod/`
- **Verifies:** `generateGproj`, addon scaffold, directory layout.
- **Risk:** Drops in same `addons/` folder as Test1 — pick a unique name with `TC_` prefix to avoid Test1 collision.
- **Time budget:** fast

### TC-SCAFFOLD-002: mod create — duplicate directory refusal

- **Input:** Same as TC-SCAFFOLD-001 but run twice in a row.
- **Expected output:** Second call returns text "Directory already exists: ..." (not isError, but message). No files clobbered.
- **Pass criteria:** Response text contains "already exists"; mtimes on `addons/TC_BareMod/TC_BareMod.gproj` unchanged.
- **Cleanup:** `rm -rf addons/TC_BareMod/`
- **Verifies:** Existence guard in `registerMod` create branch.
- **Time budget:** fast

### TC-SCAFFOLD-003: mod create — with pattern (custom-faction)

- **Input:**
  ```json
  { "action": "create", "name": "TC_FactionMod", "pattern": "custom-faction",
    "projectPath": "<addons>" }
  ```
- **Expected output:** Lists script files like `Scripts/Game/MCM_Faction.c` (or pattern's choice), config files under `Configs/`. Includes "### Pattern Instructions" section.
- **Pass criteria:**
  - All pattern-driven files exist on disk.
  - Each script file contains a `class` declaration.
  - Patterns library returned a valid def (no "Unknown pattern" error).
- **Cleanup:** `rm -rf addons/TC_FactionMod/`
- **Verifies:** Pattern application + collision check.
- **Time budget:** fast

### TC-SCAFFOLD-004: mod build — addon name missing

- **Input:** `{ "action": "build" }`
- **Expected output:** isError=true, text="Missing required parameter for action 'build': addonName".
- **Pass criteria:** `isError === true`, message matches.
- **Side effects:** None.
- **Verifies:** Required-param guard.
- **Time budget:** fast

### TC-SCAFFOLD-005: mod validate — Test1 (read-only)

- **Input:** `{ "action": "validate", "projectPath": "Test1" }`
- **Expected output:** "## Validation Report: Test1" with check results.
- **Pass criteria:**
  - `gproj` check passes (Test1 has ID, GUID, base-game dep).
  - `structure` check may warn on missing `Scripts/Game` (Test1 has `Scripts/WorkbenchGame` instead — allowed).
- **Side effects:** None (read-only).
- **Verifies:** Validator over real project.
- **Risk:** None — read-only.
- **Time budget:** fast

### TC-SCAFFOLD-006: prefab create — generic prop

- **Input:**
  ```json
  { "action": "create", "name": "TC_TestProp", "prefabType": "prop",
    "projectPath": "<sandbox>" }
  ```
- **Expected output:** "Prefab created: Prefabs/Props/TC_TestProp.et" + raw content + "Required follow-up" checklist.
- **Pass criteria:**
  - `Prefabs/Props/TC_TestProp.et` exists in sandbox.
  - Content parses as `EnfusionNode` with a root entity type.
- **Cleanup:** Delete the prefab file.
- **Verifies:** Recipe loader + template generation.
- **Time budget:** fast

### TC-SCAFFOLD-007: prefab inspect — Test1 prefab chain

- **Input:** `{ "action": "inspect", "path": "<path-to-existing-Test1-prefab>" }` (only if Test1 has one — otherwise SKIP and document)
- **Expected output:** "=== Prefab Inheritance Chain ===" + per-level breakdown + "=== Merged Components ===".
- **Pass criteria:** At least one ancestor level rendered if path resolves.
- **Side effects:** None.
- **Verifies:** `walkChain` + `mergeAncestryComponents`.
- **Time budget:** fast

### TC-SCAFFOLD-008: prefab create — missing name

- **Input:** `{ "action": "create", "prefabType": "prop" }`
- **Expected output:** isError=true, "Error creating prefab: 'name' is required for action=create".
- **Pass criteria:** isError true, message matches.
- **Verifies:** Conditional required-param.
- **Time budget:** fast

### TC-SCAFFOLD-009: script_create — basic class

- **Input:**
  ```json
  { "className": "TC_TestComponent", "scriptType": "component",
    "projectPath": "<sandbox>" }
  ```
- **Expected output:** "Script created: Scripts/Game/TC_TestComponent.c" + code block.
- **Pass criteria:**
  - File at `Scripts/Game/TC_TestComponent.c` exists.
  - Contains `class TC_TestComponent : ScriptComponent`.
- **Cleanup:** Delete the file.
- **Verifies:** Template generation + module-folder dispatch.
- **Time budget:** fast

### TC-SCAFFOLD-010: script_create — invalid identifier

- **Input:** `{ "className": "9bad", "scriptType": "basic" }`
- **Expected output:** isError=true, "Error creating script: ..." (validateEnforceIdentifier throws).
- **Pass criteria:** isError, no file written.
- **Verifies:** Identifier validation.
- **Time budget:** fast

### TC-SCAFFOLD-011: script_create — refuse existing file

- **Input:** Run TC-SCAFFOLD-009 twice.
- **Expected output:** Second call returns text "File already exists: Scripts/Game/TC_TestComponent.c" + generated code (not written).
- **Pass criteria:** First file unchanged (mtime).
- **Verifies:** Existence guard.
- **Time budget:** fast

### TC-SCAFFOLD-012: config_create — faction

- **Input:**
  ```json
  { "configType": "faction", "name": "TC_USFaction",
    "factionKey": "US", "factionColor": "30,70,140,255",
    "projectPath": "<sandbox>" }
  ```
- **Expected output:** "Config created: Configs/TC_USFaction.conf" + content. Note: this is the LEGACY `m_sKey`/`m_sName` shape — distinct from `faction_create`.
- **Pass criteria:** File exists with `SCR_Faction`-style root and `m_sKey "US"`.
- **Cleanup:** Delete file.
- **Verifies:** `config_create` faction path (separate code path from `faction_create`).
- **Time budget:** fast

### TC-SCAFFOLD-013: config_create — mission-header Conflict

- **Input:**
  ```json
  { "configType": "mission-header", "name": "TC_TestMission",
    "missionMode": "Conflict", "worldPath": "{6968F5564CA31D9D}worlds/MP/test.ent",
    "playerCount": 40, "projectPath": "<sandbox>" }
  ```
- **Expected output:** "Config created: Missions/TC_TestMission.conf". Content contains `SCR_MissionHeaderCampaign` (Conflict mode).
- **Pass criteria:**
  - File exists at `Missions/TC_TestMission.conf`.
  - Contains `SCR_MissionHeaderCampaign` (Conflict-mode class), NOT `SCR_MissionHeader` (SF-mode class).
- **Cleanup:** Delete file.
- **Verifies:** Conflict-vs-SF mode dispatch.
- **Time budget:** fast

### TC-SCAFFOLD-014: config_create — mission-header SF mode

- **Input:** Same as TC-SCAFFOLD-013 but `"missionMode": "SF"`.
- **Expected output:** Content contains `SCR_MissionHeader` (Scenario Framework class).
- **Pass criteria:** Content contains `SCR_MissionHeader` token but NOT `SCR_MissionHeaderCampaign`.
- **Cleanup:** Delete file.
- **Verifies:** SF mode dispatch.
- **Time budget:** fast

### TC-SCAFFOLD-015: layout_create — HUD

- **Input:**
  ```json
  { "name": "TC_TestHUD", "layoutType": "hud",
    "projectPath": "<sandbox>" }
  ```
- **Expected output:** "Layout created: UI/Layouts/TC_TestHUD.layout" + content.
- **Pass criteria:**
  - File at `UI/Layouts/TC_TestHUD.layout` exists.
  - Content contains a `FrameWidgetClass` root (HUD template default).
- **Cleanup:** Delete file.
- **Verifies:** Layout type dispatch + widget defaults.
- **Time budget:** fast

### TC-SCAFFOLD-016: layout_create — custom with widgets

- **Input:**
  ```json
  { "name": "TC_TestList", "layoutType": "list",
    "widgets": [
      { "type": "TextWidgetClass", "name": "Header",
        "properties": { "Text": "Hello", "ExactFontSize": "24" } }
    ],
    "projectPath": "<sandbox>" }
  ```
- **Expected output:** Content contains `TextWidgetClass` with Name "Header" and the supplied properties.
- **Pass criteria:** Widget properties round-trip into the file.
- **Cleanup:** Delete file.
- **Verifies:** Widget-array input.
- **Time budget:** fast

### TC-SCAFFOLD-017: scenario_create_conflict — full file set

- **Input:**
  ```json
  { "scenarioName": "TC_TestConflict_Everon", "worldName": "Everon",
    "bases": [
      { "name": "MOB_US", "position": "1200 0 3400", "faction": "US", "type": "MOB" },
      { "name": "MOB_USSR", "position": "8800 0 6200", "faction": "USSR", "type": "MOB" },
      { "name": "Base_Central", "position": "5000 0 5000", "faction": "US", "type": "base" }
    ],
    "civVehicleCount": 5,
    "projectPath": "<sandbox>" }
  ```
- **Expected output:** "**Conflict scenario created: TC_TestConflict_Everon**" + list of 6 files (mission .conf + world .ent + 4 .layer files including AmbientVehicles.layer because civVehicleCount > 0).
- **Pass criteria:**
  - All 6 expected files exist in `Missions/` and `Worlds/TC_TestConflict_Everon_Layers/`.
  - Mission .conf contains `SCR_MissionHeaderCampaign`.
  - World .ent has a SubScene-style parent reference (worldName resolves to known-world GUID).
  - `Bases.layer` references all 3 base entity names.
- **Side effects:** 6 new files in sandbox.
- **Cleanup:** Delete the 6 files + the `_Layers/` directory.
- **Verifies:** Full L1 scenario builder, all-or-nothing rollback.
- **Time budget:** fast

### TC-SCAFFOLD-018: scenario_create_conflict — refusal on existing files + rollback verify

- **Input:** Run TC-SCAFFOLD-017 twice.
- **Expected output:** Second call returns text "Files already exist: ..." with list of paths and unwritten generated content.
- **Pass criteria:** First scenario's mtimes unchanged.
- **Verifies:** Pre-flight existence guard.
- **Time budget:** fast

### TC-SCAFFOLD-019: scenario_create_conflict — no civilian vehicles (zero AmbientVehicles.layer)

- **Input:** Same as TC-SCAFFOLD-017 but omit `civVehicleCount` (defaults to 0).
- **Expected output:** Only 5 files (no AmbientVehicles.layer).
- **Pass criteria:** `Worlds/<name>_Layers/AmbientVehicles.layer` does NOT exist.
- **Cleanup:** Delete the 5 files.
- **Verifies:** Conditional .layer emission.
- **Time budget:** fast

### TC-SCAFFOLD-020: game_browse — list Prefabs/Weapons

- **Input:** `{ "path": "Prefabs/Weapons" }`
- **Expected output:** "Game: ...\nPath: Prefabs/Weapons" + directory listing including .pak-resident entries.
- **Pass criteria:** Output has non-empty entry list; at least one entry tagged with a type (e.g. `[prefab]`).
- **Side effects:** None.
- **Verifies:** Loose-file + .pak VFS merge.
- **Time budget:** fast

### TC-SCAFFOLD-021: game_read — read a script

- **Input:** `{ "path": "Scripts/Game/Character/SCR_CharacterControllerComponent.c" }`
- **Expected output:** File content as text (could be from .pak or extracted lib).
- **Pass criteria:** Non-empty content; contains `class SCR_CharacterControllerComponent`.
- **Time budget:** fast

### TC-SCAFFOLD-022: game_read — binary file refusal

- **Input:** `{ "path": "<any .xob>" }`
- **Expected output:** "Binary file: ..." message.
- **Pass criteria:** Not an error; message about TEXT_EXTENSIONS.
- **Verifies:** Extension allow-list.
- **Time budget:** fast

### TC-SCAFFOLD-023: asset_search — find a known prefab

- **Input:** `{ "query": "AK", "type": "prefab", "limit": 5 }`
- **Expected output:** Up to 5 entries with paths to AK*.et and (if catalog mapping is built) GUIDs.
- **Pass criteria:** At least one result with `.et` extension.
- **Time budget:** medium (first call triggers full index build, ~1s)

### TC-SCAFFOLD-024: game_duplicate — duplicate a game prefab into sandbox

- **Input:**
  ```json
  { "sourcePath": "{<guid>}Prefabs/Groups/OPFOR/Group_USSR_LightFireTeam.et",
    "destPath": "Prefabs/Groups/TC_TestGroup.et",
    "modName": "Test1_sandbox", "flatten": false, "register": false }
  ```
- **Expected output:** "Prefab duplicated successfully" or "Prefab copied (not registered)" + ancestry note showing N injected components.
- **Pass criteria:**
  - File at sandbox/Prefabs/Groups/TC_TestGroup.et exists.
  - Content has a freshly-generated `ID` (16-hex, different from source).
  - "Ancestry: resolved N level(s)" in response.
- **Cleanup:** Delete the duplicated file.
- **Verifies:** Ancestry-merging duplicate path, register=false branch.
- **Risk:** Needs game-data resolution (extracted lib or .pak). If unavailable, expect "Source file not found" error.
- **Time budget:** medium (ancestry walks)

### TC-SCAFFOLD-025: wb_entity_duplicate — Workbench-dependent skip

- **Input:** `{ "entityName": "doesNotExist", "destPath": "Prefabs/X.et" }`
- **Expected output:** Either Workbench not connected → connection-status message, or entity-not-found error.
- **Pass criteria:** Tool returns gracefully — no crash.
- **Side effects:** None.
- **Verifies:** Workbench-bridge mode guard.
- **Time budget:** fast (no live Workbench)

### TC-SCAFFOLD-026: workshop_info — Test1

- **Input:** `{ "projectPath": "Test1" }`
- **Expected output:** "**Workshop Info**" markdown with ID=Test1, GUID=6968F5564CA31D9D.
- **Pass criteria:** Both fields appear with the literal values above.
- **Time budget:** fast

### TC-SCAFFOLD-027: animation_graph action=inspect — known game .agr

- **Input:** `{ "action": "inspect", "source": "game", "path": "<path-to-any-game-.agr>" }`
- **Expected output:** Structured AGR summary (bone count, GlobalTags, params).
- **Pass criteria:** Non-empty summary; no error.
- **Risk:** Requires extracted-lib or .pak access.
- **Time budget:** medium

### TC-SCAFFOLD-028: animation_graph action=author — vehicle scaffold

- **Input:**
  ```json
  { "action": "author", "vehicleName": "TC_TestTruck", "vehicleType": "wheeled",
    "wheelCount": 4, "outputPath": "Assets/Vehicles/TC_TestTruck/workspaces",
    "modName": "Test1_sandbox" }
  ```
- **Expected output:** "Generated AGR / AST scaffold" with file paths.
- **Pass criteria:** `.agr` and `.ast` files exist under sandbox/Assets/Vehicles/TC_TestTruck/workspaces.
- **Cleanup:** Delete the directory tree.
- **Verifies:** L4 animation author path.
- **Time budget:** fast

---

## 3. L5 refactor primitives — DRY-RUN tests (no sandbox needed)

### TC-REFACTOR-001: refactor_replace_guid — dry-run on a non-existent GUID

- **Input:**
  ```json
  { "old_guid": "0123456789ABCDEF", "new_guid": "FEDCBA9876543210", "commit": false }
  ```
- **Expected output:** "## refactor_replace_guid: {...} → {...}" + "(no matches — the old GUID isn't referenced anywhere indexed)".
- **Pass criteria:** Response has "no matches"; no `.bak` created anywhere.
- **Side effects:** None.
- **Verifies:** Plan-builder path with zero candidates.
- **Time budget:** fast

### TC-REFACTOR-002: refactor_replace_guid — dry-run on Test1's GUID (real plan)

- **Input:**
  ```json
  { "old_guid": "6968F5564CA31D9D", "new_guid": "6968F5564CA31D9E", "commit": false }
  ```
- **Expected output:** "DRY-RUN. Pass `commit: true` to actually write the changes." + list of file(s) that contain the GUID.
- **Pass criteria:**
  - At minimum `addon.gproj` (the Test1 owner) appears in the file list with 1 match.
  - Response says "DRY-RUN" and references `.bak` sidecar in the footer.
  - **No files modified on disk** (mtime unchanged).
- **Side effects:** None.
- **Verifies:** Real plan builder against project-index.
- **Time budget:** fast

### TC-REFACTOR-003: refactor_replace_guid — collision refusal

- **Input:** `old_guid=6968F5564CA31D9D` (Test1), `new_guid=58D0FB3206B6F859` (base game) → triggers collision.
- **Expected output:** "❌ COLLISION — new GUID already names a resource" + base-game file path. "Refusing to replace".
- **Pass criteria:** Response contains "COLLISION"; no edits planned.
- **Verifies:** Collision detection via `index.resolveGuid`.
- **Time budget:** fast

### TC-REFACTOR-004: refactor_replace_guid — same GUID no-op

- **Input:** `old_guid=6968F5564CA31D9D`, `new_guid=6968F5564CA31D9D`.
- **Expected output:** "(no-op — old and new GUID are identical)".
- **Pass criteria:** Response contains "no-op".
- **Verifies:** Same-GUID short-circuit.
- **Time budget:** fast

### TC-REFACTOR-005: refactor_replace_guid — invalid hex rejected

- **Input:** `old_guid="ZZZZZZZZZZZZZZZZ"`.
- **Expected output:** isError=true, "Invalid GUID ... expected 16 hex chars".
- **Pass criteria:** `normalizeGuid` rejects pre-plan.
- **Verifies:** Input validation.
- **Time budget:** fast

### TC-REFACTOR-006: refactor_move_resource_path — dry-run on non-existent file

- **Input:**
  ```json
  { "project_root": "<Test1>", "old_path": "Prefabs/NoSuch.et",
    "new_path": "Prefabs/Renamed.et", "commit": false }
  ```
- **Expected output:** "❌ No resource indexed at Prefabs/NoSuch.et. Crawl your project first."
- **Pass criteria:** Response contains "No resource indexed".
- **Verifies:** Missing-source guard.
- **Time budget:** fast

### TC-REFACTOR-007: refactor_move_resource_path — flag-smuggle guard

- **Input:** `project_root=-malicious`, others valid.
- **Expected output:** isError=true, "Invalid project_root: must not start with '-'".
- **Pass criteria:** isError true.
- **Verifies:** Pre-resolve flag check (lines 207–213 of refactor-move-resource-path.ts).
- **Time budget:** fast

### TC-REFACTOR-008: refactor_rename_project_id — dry-run on Test1.gproj

- **Input:**
  ```json
  { "gproj_path": "<Test1>/addon.gproj", "old_id": "Test1",
    "new_id": "Test1_renamed", "commit": false }
  ```
- **Expected output:** "## refactor_rename_project_id" + "Would replace 1 `ID` line in the .gproj." + "DRY-RUN. Pass `commit: true` to write."
- **Pass criteria:**
  - "Would replace 1" present.
  - Test1's addon.gproj unchanged on disk.
- **Verifies:** ID-span finder + plan formatter.
- **Time budget:** fast

### TC-REFACTOR-009: refactor_rename_project_id — invalid new ID

- **Input:** `new_id="bad/slashes"`
- **Expected output:** isError=true, 'Invalid new_id "bad/slashes": only [A-Za-z0-9_\\-.] allowed'.
- **Pass criteria:** isError true.
- **Verifies:** `VALID_ID_RE` enforcement.
- **Time budget:** fast

### TC-REFACTOR-010: refactor_rename_project_id — same-id no-op

- **Input:** `old_id=Test1, new_id=Test1`.
- **Expected output:** "(no-op — old_id and new_id are identical)".
- **Pass criteria:** Response contains "no-op".
- **Time budget:** fast

### TC-REFACTOR-011: refactor_normalize_dependencies — dry-run on Test1

- **Input:** `{ "gproj_path": "<Test1>/addon.gproj", "commit": false }`
- **Expected output:** "## refactor_normalize_dependencies" + Before/After counts. Test1 has 1 dep (base game), so likely "✅ Already canonical".
- **Pass criteria:**
  - Response has both Before/After lines.
  - For Test1 specifically: After=1, no duplicates removed.
- **Verifies:** Block-finder + diff detection.
- **Time budget:** fast

### TC-REFACTOR-012: refactor_normalize_dependencies — check_resolution flag

- **Input:** `{ "gproj_path": "<Test1>/addon.gproj", "check_resolution": true, "commit": false }`
- **Expected output:** Same as TC-011 plus, if any dep doesn't resolve, "⚠ Unresolved dep GUIDs" section. Base-game GUID `58D0FB3206B6F859` should resolve if project-index has crawled the core source.
- **Pass criteria:** No exceptions thrown; report renders.
- **Verifies:** `ProjectIndex.resolveGuid` integration.
- **Time budget:** fast

### TC-REFACTOR-013: refactor_normalize_dependencies — no Dependencies block

- **Input:** Run against a .gproj-like file with no `Dependencies { ... }`. Use any non-gproj file as a probe.
- **Expected output:** "No Dependencies block found in <filename>. Already empty or non-standard shape."
- **Pass criteria:** Tool exits gracefully (no isError needed).
- **Verifies:** Missing-block branch.
- **Time budget:** fast

### TC-REFACTOR-014: refactor_merge_duplicate_guids — diagnose on Test1

- **Input:** `{ "project_root": "<Test1>" }`
- **Expected output:** "## refactor_merge_duplicate_guids (diagnose) — <path>" + "Scanned N resource files." + "✅ No duplicate GUIDs found." (assuming Test1 is clean).
- **Pass criteria:** Response has "Scanned" line and either ✅ no duplicates or a list of collisions.
- **Side effects:** None (diagnose-only).
- **Verifies:** Filesystem walk + root-GUID extraction.
- **Time budget:** medium (full project walk)

### TC-REFACTOR-015: refactor_merge_duplicate_guids — non-directory rejection

- **Input:** `{ "project_root": "<Test1>/addon.gproj" }` (a file, not a dir)
- **Expected output:** isError=true, "project_root is not a directory: ...".
- **Pass criteria:** isError true.
- **Verifies:** Directory check.
- **Time budget:** fast

### TC-REFACTOR-016: refactor_merge_duplicate_guids — missing path

- **Input:** `{ "project_root": "C:/does/not/exist" }`
- **Expected output:** isError=true, "project_root not found: ...".
- **Pass criteria:** isError true.
- **Verifies:** stat-failure branch.
- **Time budget:** fast

### TC-REFACTOR-017: refactor_remove_unused — dry-run, powershell shell

- **Input:** `{ "source": "user", "shell": "powershell", "limit": 100 }`
- **Expected output:** "## refactor_remove_unused — dry-run plan [source=user]" + (if any unused resources) PowerShell script block with `Remove-Item -Path "..." -Verbose` lines.
- **Pass criteria:**
  - Response contains "DRY-RUN ONLY"; no `.bak` files anywhere.
  - If candidates exist, each line carries `# {GUID} [user]` annotation.
- **Side effects:** None.
- **Verifies:** v1 dry-run-only contract.
- **Time budget:** fast

### TC-REFACTOR-018: refactor_remove_unused — no candidates

- **Input:** Same but expect empty result if everything in user source is referenced.
- **Expected output:** "No unused resources to remove. Nothing to do."
- **Pass criteria:** Matches that string.
- **Time budget:** fast

---

## 4. L5 refactor primitives — LIVE tests (sandboxed)

> Prerequisite: run the sandbox-setup block at the top of this doc. All paths below resolve to `<addons>/Test1_sandbox/`.

### TC-REFACTOR-101: refactor_replace_guid — live commit on sandbox GUID

- **Setup:** Sandbox created with GUID `6968F5564CA31D9E`.
- **Input:**
  ```json
  { "old_guid": "6968F5564CA31D9E", "new_guid": "AAAA0000BBBB1111", "commit": true, "force": false }
  ```
- **Expected output:** "✅ Committed. `.bak` sidecars left next to each modified file."
- **Pass criteria:**
  - `addon.gproj` now contains GUID `AAAA0000BBBB1111` (uppercase).
  - `addon.gproj.bak` exists next to it with the OLD GUID.
  - `diff <(grep -c AAAA0000BBBB1111 addon.gproj) <(grep -c 6968F5564CA31D9E addon.gproj.bak)` shows the swap.
- **Side effects:** `addon.gproj` mutated; `.bak` sidecar created.
- **Cleanup:** `mv addon.gproj.bak addon.gproj` to restore; commit to clean git state before next test.
- **Verifies:** End-to-end atomic commit + `.bak` creation.
- **Risk:** If git state was dirty, tool refuses (correct behavior).
- **Time budget:** fast

### TC-REFACTOR-102: refactor_replace_guid — live commit refuses on dirty git

- **Setup:** Sandbox at git-clean. Manually `echo " " >> addon.gproj` to dirty it.
- **Input:** Same as TC-101.
- **Expected output:** isError=true, "Refusing to write ... uncommitted changes ... pass `force: true`".
- **Pass criteria:** `addon.gproj` mtime unchanged from the dirty state.
- **Cleanup:** `git checkout addon.gproj` to restore.
- **Verifies:** `checkGitState` integration.
- **Time budget:** fast

### TC-REFACTOR-103: refactor_replace_guid — live commit with force=true bypasses git check

- **Setup:** Same dirty state as TC-102.
- **Input:** Same but `"force": true`.
- **Expected output:** "✅ Committed".
- **Pass criteria:** GUID replaced even on dirty git.
- **Cleanup:** Restore from .bak; reset git.
- **Verifies:** Force bypass.
- **Time budget:** fast

### TC-REFACTOR-104: refactor_rename_project_id — live commit on sandbox

- **Setup:** Sandbox at clean git, ID=`Test1_sandbox`.
- **Input:**
  ```json
  { "gproj_path": "<sandbox>/addon.gproj", "old_id": "Test1_sandbox",
    "new_id": "Test1_renamed", "commit": true, "force": false }
  ```
- **Expected output:** "Replaced 1 `ID` line in the .gproj." + "✅ Committed."
- **Pass criteria:**
  - `addon.gproj` now contains `ID "Test1_renamed"`.
  - `addon.gproj.bak` exists with original `ID "Test1_sandbox"`.
- **Cleanup:** Restore from .bak.
- **Verifies:** Surgical line edit + .bak.
- **Time budget:** fast

### TC-REFACTOR-105: refactor_move_resource_path — live commit (skip if no movable file)

- **Setup:** Create a throwaway prefab in the sandbox first via TC-SCAFFOLD-006 against the sandbox. Then re-crawl (restart MCP) so it's in the project-index.
- **Input:**
  ```json
  { "project_root": "<sandbox>",
    "old_path": "Prefabs/Props/TC_TestProp.et",
    "new_path": "Prefabs/Props/TC_TestProp_Renamed.et",
    "commit": true, "force": false }
  ```
- **Expected output:** "✅ Committed. File renamed; .bak sidecars left next to each updated ref-file."
- **Pass criteria:**
  - Old path no longer exists; new path does.
  - If any other file referenced the old path, that file has a `.bak`.
  - Refs in the renamed file body now use `{GUID}<newPath>`.
- **Cleanup:** Reverse the rename via the tool again, then remove the .bak sidecars.
- **Verifies:** Two-phase commit (ref edits, then rename).
- **Risk:** Requires the project-index to have crawled the sandbox — restart MCP if not.
- **Time budget:** medium (depends on index size)

### TC-REFACTOR-106: refactor_normalize_dependencies — live commit with intentional dups

- **Setup:** Edit the sandbox's `addon.gproj` to make Dependencies have a duplicate:
  ```
  Dependencies {
    "58D0FB3206B6F859"
    "58D0FB3206B6F859"
  }
  ```
  Commit that change so git is clean.
- **Input:** `{ "gproj_path": "<sandbox>/addon.gproj", "commit": true }`
- **Expected output:** "After: 1 entries (1 duplicates removed)" + "✅ Committed".
- **Pass criteria:** addon.gproj now has only 1 dep line; `.bak` has 2.
- **Cleanup:** Restore from .bak; reset git.
- **Verifies:** Dedupe + .bak rewrite of the whole file (not just the dep block).
- **Time budget:** fast

### TC-REFACTOR-107: refactor_merge_duplicate_guids — collision injection

- **Setup:** Manually copy `addon.gproj` to `addon.gproj.duplicate` inside the sandbox (same GUID). The scanner should detect both.
- **Input:** `{ "project_root": "<sandbox>" }`
- **Expected output:** "Found 1 GUID collision" + a `### {GUID}` block listing both files.
- **Pass criteria:** Collision section present with at least both file paths.
- **Cleanup:** Delete the copy.
- **Verifies:** Disk-walk collision detection.
- **Time budget:** medium

---

## 5. L3 server config tests

### TC-SERVERCFG-001: server_config — write fresh server.json with RCON

- **Input:**
  ```json
  { "name": "TC TestServer", "scenarioId": "{GUID}Missions/X.conf",
    "maxPlayers": 16, "bindPort": 2001, "rconPassword": "secret",
    "passwordAdmin": "adminpass", "admins": ["76561198000000000"],
    "projectPath": "<sandbox>" }
  ```
- **Expected output:** "Server config written: <sandbox>/server.json" + "Redacted contents (real secrets are on disk):" with JSON where `passwordAdmin` and `rcon.password` show `<redacted>`.
- **Pass criteria:**
  - File `<sandbox>/server.json` exists.
  - File on disk contains literal `secret` and `adminpass` (NOT redacted on disk).
  - Tool response NEVER contains `secret` or `adminpass` text — only `<redacted>`.
- **Cleanup:** Delete `<sandbox>/server.json`.
- **Verifies:** SEC-001/SEC-002 redaction boundary.
- **Risk:** Test must assert the response transcript is redacted — load-bearing security check.
- **Time budget:** fast

### TC-SERVERCFG-002: server_config — refuse on existing file

- **Setup:** Run TC-001 first.
- **Input:** Same as TC-001.
- **Expected output:** "File already exists: server.json (pass overwrite=true to replace)" + redacted preview.
- **Pass criteria:** Original file untouched.
- **Cleanup:** Delete server.json.
- **Verifies:** Existence guard.
- **Time budget:** fast

### TC-SERVERCFG-003: server_config — overwrite=true

- **Setup:** Existing file from TC-001.
- **Input:** Same plus `"overwrite": true`, change maxPlayers to 32.
- **Expected output:** "Server config written" + new value reflected in redacted preview.
- **Pass criteria:** File on disk shows maxPlayers=32.
- **Cleanup:** Delete server.json.
- **Verifies:** Overwrite branch.
- **Time budget:** fast

### TC-SERVERCFG-004: server_validate_config — valid file

- **Input:** `{ "server_config_path": "<sandbox>/server.json" }` (from TC-001)
- **Expected output:** Validation findings, mostly clean.
- **Pass criteria:** Either no errors, or only known warnings (e.g. if scenarioId GUID doesn't resolve).
- **Side effects:** None.
- **Verifies:** Linter over real config.
- **Time budget:** fast

### TC-SERVERCFG-005: server_validate_config — deprecated field detection

- **Setup:** Hand-write a server.json that uses `gameHostBindPort` (deprecated). Save to sandbox.
- **Input:** `{ "server_config_path": "<that file>" }`
- **Expected output:** Warning with hint "Rename to 'bindPort'".
- **Pass criteria:** Response references the deprecated-field map.
- **Cleanup:** Delete the test file.
- **Verifies:** `DEPRECATED_FIELD_MAP` enforcement.
- **Time budget:** fast

---

## 6. L3 Workbench-CLI thin wrappers

### TC-WBCLI-001: wb_validate_scripts — flag-smuggle reject

- **Input:** `{ "gproj_path": "-evil" }`
- **Expected output:** isError=true, "Invalid gproj_path: must not start with '-' ...".
- **Pass criteria:** isError true.
- **Verifies:** Pre-resolve guard.
- **Time budget:** fast

### TC-WBCLI-002: wb_validate_scripts — non-existent .gproj

- **Input:** `{ "gproj_path": "C:/does/not/exist.gproj" }`
- **Expected output:** isError=true, ".gproj not found: ...".
- **Pass criteria:** isError true.
- **Verifies:** Existence check before spawn.
- **Time budget:** fast

### TC-WBCLI-003: wb_validate_scripts — real validate on Test1

- **Input:** `{ "gproj_path": "<Test1>/addon.gproj", "config": "PC", "timeout_seconds": 60 }`
- **Expected output:** "## wb_validate_scripts" + Exit code + Duration + last lines of stdout/stderr.
- **Pass criteria:**
  - Exit code 0 if Test1's scripts are valid; non-zero with error tail otherwise — both are passing test outcomes.
  - Duration > 0.
  - **No mutation of Test1 — read-only spawn.**
- **Side effects:** Spawns Workbench-Diag for ~30–60s. No file edits.
- **Verifies:** CLI spawn + tail.
- **Risk:** Workbench-Diag must be installed. If absent, expect a different error path.
- **Time budget:** slow (30–60s)

### TC-WBCLI-004: wb_cli_run — disallowed command rejection

- **Input:** `{ "command": "openProject", "target": "-flagvalue", ... }`
- **Expected output:** isError=true, "Invalid target: must not start with '-' ...".
- **Pass criteria:** isError true.
- **Verifies:** Target guard.
- **Time budget:** fast

### TC-WBCLI-005: wb_cli_run — valid openProject (live spawn)

- **Input:** `{ "command": "openProject", "target": "<Test1>/addon.gproj", "timeout_seconds": 30 }`
- **Expected output:** Exit code + duration + tail.
- **Pass criteria:** Spawn completes (any exit code OK); tool returns without crashing.
- **Side effects:** Brief Workbench launch.
- **Verifies:** Command planner + spawn.
- **Time budget:** slow

### TC-WBCLI-006: wb_build_data — flag-smuggle on both paths

- **Input:** `{ "gproj_path": "-bad", "out_dir": "C:/tmp/out" }`
- **Expected output:** isError=true.
- **Pass criteria:** isError true.
- **Verifies:** Loop guard over both inputs.
- **Time budget:** fast

### TC-WBCLI-007: wb_build_data — non-existent gproj

- **Input:** `{ "gproj_path": "C:/no.gproj", "out_dir": "C:/tmp/out" }`
- **Expected output:** isError=true, ".gproj not found".
- **Pass criteria:** isError true.
- **Verifies:** Existence check.
- **Time budget:** fast

### TC-WBCLI-008: wb_build_data — real packed build (optional)

- **Input:** `{ "gproj_path": "<sandbox>/addon.gproj", "out_dir": "<temp>/build_out", "platform": "PC", "timeout_seconds": 300 }`
- **Expected output:** Long-running spawn, exit code reported.
- **Pass criteria:** Tool returns within timeout; out_dir contains build artifacts on success.
- **Side effects:** Creates packed output. Cleanup: `rm -rf` the out_dir.
- **Verifies:** Full build orchestration.
- **Time budget:** slow (1–10 min)

---

## 7. L7 EMCP terrain bridge

The handler may or may not be deployed. Tests cover both states.

### TC-TERRAIN-001: terrain_inspect — flag-smuggle reject

- **Input:** `{ "world_path": "-evil" }`
- **Expected output:** isError=true, "Invalid world_path: must not start with '-'".
- **Pass criteria:** isError true.
- **Verifies:** Pre-call guard.
- **Time budget:** fast

### TC-TERRAIN-002: terrain_inspect — handler not deployed

- **Setup:** Workbench not running OR EMCP_WB_Terrain.c not loaded.
- **Input:** `{ "world_path": "worlds/MP/SomeMap.ent" }`
- **Expected output:** isError=true with text starting "EMCP_WB_Terrain handler not deployed in Workbench. Deploy mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Terrain.c (see docs/L7-PLAN.md) and reload the editor."
- **Pass criteria:**
  - Response text contains "EMCP_WB_Terrain handler not deployed".
  - References `docs/L7-PLAN.md`.
  - `isError: true`.
- **Verifies:** Degrade-gracefully path (terrain-inspect.ts lines 90–104).
- **Time budget:** fast

### TC-TERRAIN-003: terrain_inspect — handler returns ok

- **Setup:** Workbench running, EMCP_WB_Terrain handler deployed.
- **Input:** Same as TC-002, but with a real world that the handler can resolve.
- **Expected output:** "## terrain_inspect: <world>" + bullet list of Bounds / Tile count / etc.
- **Pass criteria:** Response has formatTerrainSummary output. No isError.
- **Verifies:** Full live path.
- **Risk:** Depends on handler implementation that's described as ship-next-session.
- **Time budget:** medium

### TC-TERRAIN-004: terrain_navmesh_status — placeholder shape

- **Setup:** Workbench running but handler returns `status: "not_implemented"` (current state per L7-1).
- **Input:** `{ "world_path": "worlds/MP/SomeMap.ent" }`
- **Expected output (EXACT shape):**
  ```
  Navmesh status query is not yet implemented in the Workbench-side handler. Tracking: docs/L7-PLAN.md (L7-1 EMCP_WB_Terrain navmesh_status). Underlying message: <message-from-handler-or-"(none)">
  ```
- **Pass criteria:**
  - Response contains literal "Navmesh status query is not yet implemented".
  - Contains "docs/L7-PLAN.md".
  - **NOT isError** (placeholder is a polite degrade, not an error).
- **Verifies:** Lines 55–67 of terrain-navmesh-status.ts.
- **Time budget:** fast

### TC-TERRAIN-005: terrain_navmesh_status — flag-smuggle reject

- **Input:** `{ "world_path": "-bad" }`
- **Expected output:** isError=true, "Invalid world_path: must not start with '-'".
- **Pass criteria:** isError true.
- **Time budget:** fast

### TC-TERRAIN-006: terrain_road_export_graph — placeholder shape, json

- **Setup:** Handler returns `status: "not_implemented"`.
- **Input:** `{ "world_path": "worlds/MP/SomeMap.ent", "format": "json" }`
- **Expected output:** Text contains "Road graph export is not yet implemented in the Workbench handler. Tracking: docs/L7-PLAN.md (L7-1 EMCP_WB_Terrain road_export_graph). Will use RoadNetworkManager.GetRoadsInAABB once wired."
- **Pass criteria:**
  - Response contains "Road graph export is not yet implemented".
  - Contains "docs/L7-PLAN.md".
  - **NOT isError.**
- **Verifies:** Lines 55–67 of terrain-road-export-graph.ts.
- **Time budget:** fast

### TC-TERRAIN-007: terrain_road_export_graph — placeholder shape, mermaid

- **Input:** Same as TC-006, `"format": "mermaid"`.
- **Expected output:** Same placeholder text (handler returns placeholder before format branch).
- **Pass criteria:** Same as TC-006.
- **Verifies:** Placeholder fires before format dispatch.
- **Time budget:** fast

### TC-TERRAIN-008: terrain_road_export_graph — flag-smuggle reject

- **Input:** `{ "world_path": "-bad", "format": "json" }`
- **Expected output:** isError=true.
- **Time budget:** fast

---

## 8. L8 write-mode dry-runs (sandbox)

### TC-L8WRITE-001: scenario_clone_area — dry_run preview

- **Setup:** Use one of the sandbox's existing .layer files (e.g. from a scenario_create_conflict run inside the sandbox).
- **Input:**
  ```json
  { "source_layer_path": "<sandbox>/Worlds/Bases.layer",
    "dest_layer_path": "<sandbox>/Worlds/BasesClone.layer",
    "area": { "minX": 0, "minZ": 0, "maxX": 10000, "maxZ": 10000 },
    "dry_run": true, "force": false }
  ```
- **Expected output:** "## scenario_clone_area: DRY-RUN" + Source / Dest / Entities cloned / GUID swaps count + sample swaps + "DRY-RUN. Pass `dry_run: false` (default) to write the destination layer."
- **Pass criteria:**
  - "DRY-RUN" header present.
  - **No file created at dest path.**
- **Side effects:** None.
- **Cleanup:** None.
- **Verifies:** Dry-run short-circuit.
- **Time budget:** fast

### TC-L8WRITE-002: scenario_clone_area — empty area returns helpful message

- **Input:** Same but area is a 1-meter box at origin (no entities should be inside).
- **Expected output:** "No top-level entities in <source> fell inside area ..."
- **Pass criteria:** Response contains "No top-level entities".
- **Verifies:** Zero-match branch.
- **Time budget:** fast

### TC-L8WRITE-003: scenario_clone_area — path-containment violation

- **Input:** `dest_layer_path` outside the project root, e.g. `"C:/tmp/escape.layer"`.
- **Expected output:** isError=true, "...must resolve inside projectPath..." (from assertInsideRoot).
- **Pass criteria:** isError true; no file created outside the project.
- **Verifies:** Audit fix H-3.
- **Time budget:** fast

### TC-L8WRITE-004: scenario_clone_area — dest exists without force

- **Setup:** Create a file at the dest path manually.
- **Input:** Default args (dry_run=false default).
- **Expected output:** isError=true, "Destination already exists: ... Pass `force: true` to overwrite".
- **Pass criteria:** isError true; existing file untouched.
- **Cleanup:** Delete the placeholder.
- **Verifies:** Overwrite guard.
- **Time budget:** fast

### TC-L8WRITE-005: scenario_clone_area — live write with dry_run=false

- **Setup:** Sandbox at clean git state; valid source layer with entities inside the area.
- **Input:** Same as TC-001 but `"dry_run": false`.
- **Expected output:** "## scenario_clone_area: WRITTEN" + "Wrote <dest> (.bak sidecar preserved next to the file)."
- **Pass criteria:**
  - Dest layer file exists with cloned entities (count matches dry-run).
  - All cloned entities have NEW GUIDs (no overlap with source).
  - If dest pre-existed (overwrite path), a `.bak` is next to it.
- **Side effects:** New layer file in sandbox.
- **Cleanup:** Delete dest file and .bak.
- **Verifies:** End-to-end clone + GUID swap.
- **Time budget:** fast

### TC-L8WRITE-006: scenario_apply_template — dry_run default

- **Setup:** A target .layer file in the sandbox.
- **Input:**
  ```json
  { "target_layer_path": "<sandbox>/Worlds/Bases.layer",
    "template_name": "fob_basic",
    "position": { "x": 1000, "y": 0, "z": 2000 },
    "rotation_yaw_deg": 0 }
  ```
  (dry_run defaults to true)
- **Expected output:** "## scenario_apply_template: DRY-RUN" + Template description + Position + Yaw + Entities stamped count + "### Placeholder resources to replace" with sentinel-GUID list + "DRY-RUN. Pass `dry_run: false` to actually write the target layer."
- **Pass criteria:**
  - "DRY-RUN" present.
  - **Target file unchanged on disk** (mtime check).
- **Verifies:** Dry-run-by-default safety.
- **Time budget:** fast

### TC-L8WRITE-007: scenario_apply_template — flag-smuggle reject

- **Input:** `{ "target_layer_path": "-bad", "template_name": "fob_basic", "position": { ... } }`
- **Expected output:** Error from `rejectFlagShape`, isError=true.
- **Pass criteria:** isError true.
- **Time budget:** fast

### TC-L8WRITE-008: scenario_apply_template — live stamp with dry_run=false

- **Setup:** Sandbox at clean git; target layer file present.
- **Input:** Same as TC-006 plus `"dry_run": false`.
- **Expected output:** "## scenario_apply_template: WRITTEN" + "Wrote <path> (.bak sidecar preserved ...)".
- **Pass criteria:**
  - Target file size grew (entities appended).
  - `.bak` sidecar exists with original content.
  - `diff target.layer target.layer.bak` shows additions only (no deletions).
- **Cleanup:** Restore from .bak.
- **Verifies:** writeWithBackup path.
- **Time budget:** fast

### TC-L8WRITE-009: faction_create — dry_run preview

- **Input:**
  ```json
  { "faction_key": "TC_TEST", "display_name": "Test Faction",
    "color_rgb": { "r": 200, "g": 100, "b": 50 },
    "dry_run": true }
  ```
- **Expected output:** "**faction_create (dry_run)** — target: <sandbox>/Configs/Factions/TC_TEST.conf" + fenced rendered content with `SCR_Faction "SCR_Faction"`, `m_sFactionKey "TC_TEST"`, etc.
- **Pass criteria:**
  - Target file does NOT exist on disk.
  - Rendered content has `m_FactionColor { R 200, G 100, B 50, A 1 }`.
- **Verifies:** Pure renderer path.
- **Time budget:** fast

### TC-L8WRITE-010: faction_create — invalid faction_key

- **Input:** `{ "faction_key": "lowercase", "display_name": "X" }`
- **Expected output:** isError=true, "Invalid faction_key ... must match /^[A-Z][A-Z0-9_]{1,15}$/...".
- **Pass criteria:** isError true.
- **Verifies:** `validateFactionKey`.
- **Time budget:** fast

### TC-L8WRITE-011: faction_create — invalid color channel

- **Input:** `{ "faction_key": "TC_TEST", "display_name": "X", "color_rgb": { "r": 300, "g": 0, "b": 0 } }`
- **Expected output:** Validation error from Zod (`.max(255)`).
- **Pass criteria:** isError true.
- **Verifies:** Zod range constraint.
- **Time budget:** fast

### TC-L8WRITE-012: faction_create — out_path containment guard

- **Input:** `{ "faction_key": "TC_TEST", "display_name": "X", "out_path": "../../../escape.conf" }`
- **Expected output:** isError=true (assertInsideRoot rejects).
- **Pass criteria:** isError true; no file written outside project.
- **Verifies:** CWE-22 / H-3 fix.
- **Time budget:** fast

### TC-L8WRITE-013: faction_create — live write to sandbox

- **Setup:** Clean git in sandbox.
- **Input:** Same as TC-009 but `"dry_run": false`.
- **Expected output:** "**Faction config created**: <sandbox>/Configs/Factions/TC_TEST.conf" + rendered content + "Next steps:" with kb path.
- **Pass criteria:**
  - File exists at `Configs/Factions/TC_TEST.conf`.
  - Content matches dry-run rendering.
- **Cleanup:** Delete file; git checkout.
- **Verifies:** End-to-end live write.
- **Time budget:** fast

### TC-L8WRITE-014: faction_create — refuse overwrite without force

- **Setup:** TC-013 has run; file exists.
- **Input:** Same as TC-013.
- **Expected output:** isError=true, "Refusing to overwrite existing file: ... Pass force=true to overwrite, or dry_run=true to preview."
- **Pass criteria:** isError true; file's content unchanged from TC-013 result.
- **Cleanup:** Delete file.
- **Verifies:** Overwrite guard.
- **Time budget:** fast

### TC-L8WRITE-015: faction_create — refuse dirty git

- **Setup:** Dirty the sandbox git (touch any file).
- **Input:** Same as TC-013 (file doesn't exist yet).
- **Expected output:** isError=true, "Refusing to write ... uncommitted changes ... pass force=true to override."
- **Pass criteria:** isError true; faction file not written.
- **Cleanup:** `git checkout .` in sandbox; delete any faction file.
- **Verifies:** Git-clean check on parent dir.
- **Time budget:** fast

---

## 9. L8 server lifecycle (security-sensitive)

### TC-LIFECYCLE-001: server_launch — dry_run default (no spawn)

- **Setup:** Have a server.json in the sandbox (from TC-SERVERCFG-001).
- **Input:**
  ```json
  { "server_config_path": "<sandbox>/server.json",
    "scenario_id": "{ABCDEF0123456789}Missions/Test.conf" }
  ```
  (dry_run defaults to true)
- **Expected output:** "## server_launch (dry run — nothing spawned)" + "**Exe:** ..." + "**Argv (display only):** ..." + "### Redacted server.json (...)" + JSON with `<redacted>` for passwords + "_Re-call with `dry_run: false` to actually spawn the server._"
- **Pass criteria:**
  - **NO child process is spawned** — verify via `tasklist | grep ArmaReforger` shows no new process during/after the call.
  - Response shows redacted JSON.
  - **No `.arma-reforger-server.pid` file written** anywhere.
- **Side effects:** None. THIS IS THE LOAD-BEARING SAFETY GUARANTEE.
- **Verifies:** dry_run=true safety contract.
- **Risk:** If a spawn fires here, the safety contract is broken — the most important assertion.
- **Time budget:** fast

### TC-LIFECYCLE-002: server_launch — exe not found

- **Setup:** No `ArmaReforgerServer.exe` installed at the probed paths.
- **Input:** Same as TC-001 but `"dry_run": false`.
- **Expected output:** isError=true with text exactly: "ArmaReforgerServer.exe not found at <path>. Install Steam app 1874900 (Arma Reforger Server) — separate download from the game / Tools."
- **Pass criteria:**
  - Response text contains "ArmaReforgerServer.exe not found at".
  - References Steam app 1874900.
  - isError true.
  - No spawn.
- **Verifies:** Pre-spawn existence check.
- **Time budget:** fast

### TC-LIFECYCLE-003: server_launch — invalid extra_args regex

- **Input:** `{ ..., "extra_args": ["-good", "rm -rf /"] }` (the second has a space — should fail regex)
- **Expected output:** Error from `prepareLaunchInputs` — extra-arg validation failure.
- **Pass criteria:** isError true; no spawn.
- **Verifies:** Allow-list regex on extra_args.
- **Time budget:** fast

### TC-LIFECYCLE-004: server_launch — too many extra_args

- **Input:** `extra_args` array with 11 entries.
- **Expected output:** Zod validation error (`.max(10)`).
- **Pass criteria:** isError true.
- **Time budget:** fast

### TC-LIFECYCLE-005: server_launch — live spawn (ONLY if Steam app 1874900 installed)

- **Setup:** ArmaReforgerServer.exe present; server.json valid; sandbox clean.
- **Input:** Same as TC-001 with `"dry_run": false`.
- **Expected output:** "## server_launch (spawned)" + PID line + PID-file path + redacted JSON + "_Server is running in the background. Use `server_health_probe`..._".
- **Pass criteria:**
  - Child process detected via `tasklist`.
  - `<sandbox>/.arma-reforger-server.pid` exists with PID matching.
  - Tool returns immediately (does NOT block on server lifetime).
- **Side effects:** Live server process running.
- **Cleanup:** Run TC-LIFECYCLE-007 (server_stop) immediately after.
- **Verifies:** End-to-end spawn + PID-file write.
- **Risk:** Leaves a server running if not cleaned up. Always pair with server_stop.
- **Time budget:** medium

### TC-LIFECYCLE-006: server_launch — double-launch refusal

- **Setup:** TC-005 has spawned a server; PID file is alive.
- **Input:** Same as TC-005 (still dry_run=false).
- **Expected output:** isError=true, "## server_launch — refused (already running)" + PID + Started + Scenario + PID file path + "Use `server_stop` to terminate it, or re-call with `force: true`...".
- **Pass criteria:**
  - isError true.
  - Response references the existing PID.
  - No second process spawned.
- **Verifies:** `checkRunningServer` guard.
- **Time budget:** fast

### TC-LIFECYCLE-007: server_stop — terminate after spawn

- **Setup:** Server running (from TC-005).
- **Input:** `{ "server_config_path": "<sandbox>/server.json" }`
- **Expected output:** "## server_stop — `stopped`" + PID + Started + Scenario + PID-file path + "Server process exited cleanly after SIGTERM. PID file removed."
- **Pass criteria:**
  - Tool returns within ~5s.
  - PID file gone after call.
  - `tasklist` shows the server process no longer alive.
- **Verifies:** Graceful SIGTERM path.
- **Time budget:** medium

### TC-LIFECYCLE-008: server_stop — not-running idempotent

- **Setup:** Server already stopped (from TC-007).
- **Input:** Same as TC-007.
- **Expected output:** "## server_stop — `not_running`" + "No live server matched the PID file...".
- **Pass criteria:** Status is `not_running`; tool returns without crashing.
- **Verifies:** Idempotent stop.
- **Time budget:** fast

### TC-LIFECYCLE-009: server_stop — flag-smuggle

- **Input:** `{ "server_config_path": "-evil" }`
- **Expected output:** isError=true (rejectFlagLikePath).
- **Pass criteria:** isError true.
- **Time budget:** fast

### TC-LIFECYCLE-010: server_launch — force=true bypasses double-launch

- **Setup:** Re-run TC-005 to spawn server.
- **Input:** Same as TC-006 plus `"force": true`.
- **Expected output:** Second spawn fires. Two servers running (will fight for the port — that's the user's problem).
- **Pass criteria:**
  - Second PID returned.
  - `tasklist` shows two ArmaReforgerServer processes.
- **Cleanup:** Kill both via OS, since `server_stop` reads the single PID file. (After this test, manually run `taskkill /F /IM ArmaReforgerServer.exe`.)
- **Verifies:** force-bypass branch.
- **Risk:** Leaves processes orphaned — manual cleanup required.
- **Time budget:** slow

---

## 10. L8 prompts (test by invocation)

### TC-PROMPT-001: mission_setup — required arg only

- **Input:** `{ "mission_name": "Operation TestStorm" }`
- **Expected output:** A single user-role message whose `content.text` starts with "I want to scaffold a new mission for an Arma Reforger mod." and lists `mission_name = "Operation TestStorm"`, `template = conflict` (default), `factions = US, FIA` (default).
- **Pass criteria:**
  - Returns `{ messages: [{ role: "user", content: { type: "text", text: ... } }] }`.
  - Text contains "Step 1 — Confirm the template choice" through "Step 6 — Report back".
  - Conflict-step render block is selected (template default).
- **Verifies:** Prompt registration + default-arg substitution + step rendering.
- **Time budget:** fast

### TC-PROMPT-002: mission_setup — game_master template

- **Input:** `{ "mission_name": "TC GMSession", "template": "game_master" }`
- **Expected output:** Text contains `renderGameMasterStep` body — "Use **`config_create`** with `configType: \"mission-header\"` and `missionMode: \"Conflict\"`".
- **Pass criteria:** Game-master branch text appears; Conflict-branch text does not.
- **Verifies:** Template branching.
- **Time budget:** fast

### TC-PROMPT-003: mission_setup — combat_ops template

- **Input:** `{ "mission_name": "TC SF Mission", "template": "combat_ops" }`
- **Expected output:** Text contains `renderCombatOpsStep` body — `missionMode: "SF"` reference.
- **Pass criteria:** SF-branch text appears.
- **Verifies:** SF branching.
- **Time budget:** fast

### TC-PROMPT-004: mission_setup — custom factions

- **Input:** `{ "mission_name": "TC Test", "factions": ["FIA", "USSR"] }`
- **Expected output:** Faction-list section shows backticked `FIA`, `USSR`. Step 3 generates 2 `faction_create` call blocks. Scenario JSON uses FIA/USSR as base factions.
- **Pass criteria:**
  - Exactly 2 `faction_create` call blocks in step 3.
  - Each block has `dry_run: true`.
  - Display names match `guessDisplayName` map (FIA → "Forces of Independence and Autonomy", USSR → "Soviet Armed Forces").
- **Verifies:** Faction iteration in prompt body.
- **Time budget:** fast

### TC-PROMPT-005: character_anim_pipeline_guide — beginner default

- **Input:** `{}` (all args optional)
- **Expected output:** Message text starts "Walk me through Enfusion's character animation pipeline for a **soldier**. Target reading level: **beginner**." and contains the "## 1. The layer cake" table.
- **Pass criteria:**
  - Layer cake table present (skeleton/clips/AGF/ASI/AGR).
  - "## 4. Report back" present (beginner ends at section 4).
  - NO "## 4. Common pitfalls (intermediate)" — that's intermediate-level content.
- **Verifies:** Default args + beginner-level render.
- **Time budget:** fast

### TC-PROMPT-006: character_anim_pipeline_guide — intermediate

- **Input:** `{ "audience_level": "intermediate" }`
- **Expected output:** Contains "## 4. Common pitfalls (intermediate)" section. Final section is "## 5. Report back".
- **Pass criteria:** Intermediate section present; expert section absent.
- **Verifies:** Intermediate branch.
- **Time budget:** fast

### TC-PROMPT-007: character_anim_pipeline_guide — expert

- **Input:** `{ "audience_level": "expert", "target_character": "pilot" }`
- **Expected output:** Text mentions "pilot" in opening sentence; contains "## 4. Common pitfalls (intermediate)" AND "## 5. Expert layer" sections.
- **Pass criteria:** Both intermediate and expert sections present; character is "pilot".
- **Verifies:** Expert branch + character-arg propagation.
- **Time budget:** fast

---

## Time budget breakdown

Aggregate by category:

| Category | Fast (<5s) | Medium (5–60s) | Slow (>60s) | Total cases |
|---|---|---|---|---|
| SCAFFOLD (L1) | 25 | 3 | 0 | 28 |
| REFACTOR dry-run | 18 | 0 | 0 | 18 |
| REFACTOR live (sandbox) | 5 | 2 | 0 | 7 |
| SERVERCFG (L3) | 5 | 0 | 0 | 5 |
| WBCLI (L3) | 4 | 0 | 4 | 8 |
| TERRAIN (L7) | 7 | 1 | 0 | 8 |
| L8WRITE | 15 | 0 | 0 | 15 |
| LIFECYCLE | 5 | 3 | 2 | 10 |
| PROMPT | 7 | 0 | 0 | 7 |
| **Total** | **91** | **9** | **6** | **106** |

Aggregate wall-clock estimate:
- Fast: 91 × 3s = ~5 min
- Medium: 9 × 20s = ~3 min
- Slow: 6 × 5 min = ~30 min (dominated by WBCLI live builds and LIFECYCLE force-spawn)
- **Total ~40 min** end-to-end, assuming Workbench + ArmaReforgerServer present. Skip the slow ones and it's ~8 min.

## Order of execution

1. **Setup phase:** sandbox creation + git init + index re-crawl (~2 min).
2. **Read-only batch:** all SCAFFOLD, PROMPT, TERRAIN-placeholder, REFACTOR dry-run tests — fast, parallelizable, no cleanup needed (~10 min).
3. **Sandboxed mutations:** REFACTOR live, L8WRITE, SERVERCFG — sequential to avoid sandbox state collisions. Each test followed by its own cleanup (~15 min).
4. **Lifecycle:** LIFECYCLE-001 through -004 (no spawn). Skip TC-005 through TC-010 unless ArmaReforgerServer is installed (~5 min for dry-run only; +20 min for live).
5. **Teardown:** sandbox rm -rf + verify Test1 untouched.

## Risk register

- **Highest risk:** TC-LIFECYCLE-005/006/010 — live spawns can orphan processes. Always pair launch with stop. Test these LAST.
- **Highest data-loss risk:** any REFACTOR live test on the wrong path. Defense-in-depth: every test asserts the sandbox path, never Test1.
- **Trickiest setup:** TC-REFACTOR-105 (move resource) requires the project-index to have crawled the sandbox — restart MCP after sandbox creation, confirm via `project_index_status` before running.
- **Index-shape dependency:** TC-REFACTOR-002 and TC-REFACTOR-014 assume Test1's GUID is indexed. Confirm via `resolve_guid 6968F5564CA31D9D` before relying on those plans.

## What is NOT covered by this plan

- Performance / load tests (project_index reload under 100k files, etc).
- Concurrency tests (two refactors racing on the same file).
- Fuzz tests against the byte-edit lib (covered separately under `tests/refactor/byte-edit.test.ts`).
- Live EMCP handler smoke tests for `terrain_inspect` once the handler ships — gated on L7-1 deployment.
- Tools owned by the other audit slices (read-only project-index queries, wb-* live tools, knowledge-base reads).
