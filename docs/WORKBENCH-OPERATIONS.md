# Live Workbench operations — field notes

Practical knowledge for driving a running Workbench through the `wb_*` tools, collected from extended live sessions. Read this before a long editing session; it will save you a restart or two.

## Handler lifecycle

`wb_launch` copies the `EMCP_WB_*.c` handler scripts into the target mod's `Scripts/WorkbenchGame/EnfusionMCP/` so they compile as part of the mod, then waits for the NET API on `127.0.0.1:5775`. Every other `wb_*` tool auto-launches if Workbench isn't running.

- **Before publishing a mod**, run `wb_cleanup` to remove the handlers. `workshop_validate_manifest` refuses publish while they're present — that's the safety net, not the primary flow.
- The NET API is TCP and path-independent: live control keeps working even if the configured `ENFUSION_WORKBENCH_PATH` is stale. Only file-path tools and the scraper care about the configured path.

## The NET API queue is single-threaded — don't stack heavy calls

Workbench processes NET API requests serially. A slow handler call (e.g. `wb_prefabs locate` walking a 170k-entity world) blocks everything behind it, and stacking several parallel heavy calls can wedge the queue entirely — subsequent calls time out even though Workbench looks fine.

**Recovery:** kill the Workbench process (`taskkill /T /F /PID <pid>` — the `/T` matters, it takes child processes too) and `wb_launch` again. A Windows quirk worth knowing: `process.kill(pid, 0)` can return `EPERM` for a live process you can't signal — treat EPERM as "alive".

**Prevention:** issue heavy calls one at a time; prefer the project-index tools (`resolve_guid`, `list_resources`) over live Workbench walks when the data is indexable offline.

## Always create entities with the `{GUID}path` form

`wb_entity_create` accepts a bare resource path (`Prefabs/.../Thing.et`), and the entity will appear in the hierarchy with the right components — **but** its resource reference is stored with a zero GUID (`{0000000000000000}path`). The mesh/textures can't resolve, the entity renders invisible or broken, and every subsequent world load logs a `Wrong GUID for resource` error.

Use the full braced form: `{26A9756790131354}Prefabs/Characters/.../Character_US_Rifleman.et`. Sources for correct GUIDs: `resolve_guid` / `find_references` (indexed content), `game_read` on the prefab header, or the wiki/KB pattern files which carry verified GUID+path pairs.

## Property writes: top-level works, component-level doesn't (yet)

`wb_entity_modify setProperty` reliably writes **top-level** entity properties (e.g. `m_sFaction` on an `SCR_SpawnPoint`, fog/lighting values on environment entities). Writes to properties **inside components** (e.g. a character's `SCR_CharacterFactionAffiliationComponent.m_sFactionKey`) currently fail — the underlying `SetVariableValue` returns false. This is a known handler limitation; check `docs/TEST-RESULTS.md` for current status.

`listProperties` on the entity gives you the top-level surface; component discovery works via `wb_entity_inspect` (component list) even where writes don't.

## Editor selection is one-way

`wb_entity_select` can *set* selection state server-side, but reading back a selection the user made **by clicking in the viewport** is not supported by the public API — `getSelected` won't see it. Workflows that need "the thing the user clicked" should have the user report the entity name (visible in the hierarchy panel) instead.

`wb_entity_list` with `nameFilter` enumerates **top-level** entities only; deeply nested children of a large world aren't reachable that way — use `wb_entity_inspect` on a known parent, or the project index for offline content.

## Session hygiene

- **Save early, save often** (`wb_save`). Long sessions with heavy NET-API mutation accumulate engine state; editor instability (including hard crashes in Workbench's UI layer) has been observed after hours of mixed scripted + manual editing. A save costs nothing.
- Environment/lighting experiments are cheap to try and cheap to revert: entity property writes (fog density, sun rotation) apply live, and `wb_undo_redo` covers scripted edits like manual ones.
- If terrain/visuals stop rendering after aggressive lighting changes, the world data is usually fine — it's a viewport stream stall. Save, then close and reopen the world.

## Logs are the ground truth

When something behaves oddly, the `logs_*` tools read Workbench's actual session logs (`logs_list` → `logs_tail`/`logs_filter`/`logs_summarize_errors`). Script VM exceptions, `SetVariableValue` failures, and resource-resolution errors all land there with timestamps — usually the fastest way to distinguish "tool bug" from "engine said no".

## The launcher can hold a CLI launch hostage

Spawning `ArmaReforgerWorkbenchSteamDiag.exe -wbProjectPath <gproj>` does not guarantee the project opens. Two launcher states silently stall the launch (both field-diagnosed 2026-08-31):

- **Projects-picker hold.** When the launcher declines to auto-open the CLI project (typically one new to its registry/scan), it shows the picker with the project *preselected* and waits for a human click on Open — while the launcher window often sits minimized (rect −32000), so nothing is visible. Signature: the session `console.log` freezes right after `Workbench Create Engine took` and the `CLI Params:` echo never appears. Remedy: restore the launcher window (`WM_SYSCOMMAND`/`SC_RESTORE`) and post `VK_RETURN` — Enter activates the preselected Open. Every launch-path tool does this automatically (`wb_validate_scripts`, `wb_cli_run`, `wb_build_data` via their `launcher_nudge` watchdog; `wb_launch` during its NET-API wait).
- **"Missing Addon Dependencies" modal.** Workbench resolves `.gproj` dependency GUIDs only from locations it scans — the Workbench addons dir, folders next to the opened project, the base game/Tools installs, and launcher-registered projects (the profile's `.projectList_app*_user*.conf` files, one `FilePath` per registered .gproj). It does **not** search the game's workshop download folder (`My Games\ArmaReforger\addons`), so a dep that only exists there blocks the open even though the game runs the mod fine. Remedy: copy the downloaded addon folder into `My Games\ArmaReforgerWorkbench\addons` as-is — `addon.gproj` + `data.pak` + `resourceDatabase.rdb` work packed, no unpacking needed. `workshop_check_deps` classifies every dep along exactly this boundary (registered projects included); the launch tools pre-flight it and name the remedy if the modal blocks a run.

The dep scan reads the same locations Workbench does, including the registered-project conf — but stays advisory: treat "not visible to the scan" as a warning, not proof of failure.
