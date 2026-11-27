# Changelog

All notable changes to this project. Dates are YYYY-MM-DD. Full notes for 2.0 are in
[docs/RELEASE-NOTES-2.0.md](docs/RELEASE-NOTES-2.0.md).

## 2.0.0-rc.2 (2026-11-26)

Fixes since rc.1. They pass the offline test suite; the live batteries have not been rerun on them yet. Arma
Reforger Tools updated to 1.9.0.42 on the same day: its script API, plugins, net functions and executable tables
read the same as 1.9.0.37 offline, and its changelog lists no Workbench change. Nothing was run against a live
1.9.0.42 Workbench.

### Fixed

- **`wb_entity_duplicate`** refuses before it saves when Workbench has not loaded the addon `modName` names
  (the engine writes into the open project), and places no copy when an entity already holds the temporary
  `<name>_copy` name.

- **`building_setup`** keeps a numbered backup (`.bak`, `.bak2`, ...) of any `.et` it replaces, and its dry run
  lists the files it would replace.
- **`scenario_apply_template`** refuses a target that is not a `.layer`, `.conf` or `.ent`. A `.et` was accepted
  and got extra root objects.
- **`refactor_move_resource_path`** refuses a resource or `.meta` with uncommitted git changes unless `force: true`,
  also when nothing refers to it; keeps a backup of the `.meta` before rewriting its Name line; refuses a referencing
  file that changed between plan and commit.
- **`server_stop`** answers `unverified` when the PID is alive but its image cannot be read (tasklist failed): nothing
  is signalled and the PID file is kept. Before, the PID file was deleted and the answer was `not_running`, so the
  next `server_launch` could start a second server. `server_launch` treats such a PID as running.
- **`wb_cleanup`** refuses (LEASE_HELD) while another session holds the Workbench lease for that mod, or for no
  named project.
- **`wb_launch`** kills the whole process tree when the launch is stuck at the launcher picker or on missing
  dependencies, not only the spawned process.
- **`wb_entity_duplicate`**: when the copy is placed but cannot take the name `<name>_copy`, the answer names the
  copy that stands in the world and no longer advises placing it again. Needs the new handler set
  (`EMCP_WB_CreateEntity` answers `created`; build stamp changed).
- **`wb_entity_duplicate`** saves the placed entity through Workbench (`wb_prefabs createTemplate`), so its
  instance overrides are kept and a project or dependency prefab works (before: a byte copy of the ancestor, game
  data only). With `replaceInScene` the copy is created on the original's layer, checked, the original deleted and
  the copy renamed to the original's name (before: layer 0, `<name>_copy`). Each failed step says what stands.
  Whether the saved `.et` inherits from the ancestor or is flattened is not verified; not run live yet (w11-54).
- **`wb_world`** `new`, `duplicate` and `saveAs` with `overwrite: true` copy every file they replace to
  `<artifacts>/world/` first; the answer's `readback.snapshot` names the folder.
- **`wb_validate_scripts`** (1.x alias) refuses `gproj_path`, `timeout_seconds` and `launcher_nudge` with
  `INVALID_ARGUMENT`. They were silently ignored, so a `gproj_path` naming another project got the open project's
  result.

## 2.0.0-rc.1 (2026-11-16)

This is a release candidate, not the final 2.0.0. It ships the 2.0 code as it stands; some release
checks are still open, and 2.0.0 follows once the remaining plan items are done. What is not finished
is listed under "Release candidate" in [docs/RELEASE-NOTES-2.0.md](docs/RELEASE-NOTES-2.0.md).

Built and checked against Arma Reforger Tools build 1.9.0.37 (`data/census/current-build.json`).

### Added

- **150 tools under `ENFUSION_TOOLSET=all`**: 26 core, 111 extended, 13 aliases (generated list:
  [docs/tools/reference/index.md](docs/tools/reference/index.md)). 1.0.0 had 112; 38 names are new and
  all 112 old names still register under `all`.
- **Toolsets.** `ENFUSION_TOOLSET=core|extended|all` picks what the server lists (default `core`, 26
  tools). `ENFUSION_TOOLS=+name,-name` adds or drops single tools; `-` wins. A bad value stops the
  server at start-up.
- **Project guard on any project.** The mutating live tools work on the project that carries the
  handler set, whatever its name. A write needs a clean relative path to a file that already exists
  inside that project. Game and dependency files are never written. Writes are dry runs unless
  `confirm: true`.
- **Census and `wb_census`.** A ledger of Workbench and game surfaces (`data/census/`), with
  generated KB pages (`data/kb/census/`). `wb_census` (core) answers what a surface is, where it
  lives, and `howto` names the tool and action that reach it, or says why none can yet.
- **Kernel tools:** `wb_module` (list, info, open, front, setResource, save, allow-listed menu action; `close` is
  refused, the user closes a module by hand),
  `wb_container` (BaseContainer read and write), `wb_scripts` (compile train), `wb_meta`,
  `wb_plugin` (catalog, presence, settings), `wb_bi` (Bohemia's own NET handlers, read-only subset),
  `wb_gui` (UI Automation; opt-in with `ENFUSION_GUI=1`, Windows only), `wb_cli_run`, `wb_build_data`.
- **Offline, lossless file editors:** `config_edit`, `layout_edit`, `imageset`, `meta_file`,
  `project_settings`, `string_table`, `behavior_tree`, `animation_set`, `animation_workspace`,
  `procanim`, `audio`, `particle`, `navmesh`.
- **Wave tools:**
  - W1 World Editor core: `wb_entity`, `wb_view`, `wb_world`.
  - W2 and W3 Resource Manager, Script, String, Dialogue: offline string tables, `script_lsp`
    (read-only Script Editor language server client).
  - W4 Animation, Procedural Animation, Behavior: `wb_anim`, `wb_anim_debug`.
  - W5 Audio, Particle, Navmesh: `wb_audio`, `wb_particle`, `wb_navmesh`.
  - W6 Plugins and tools: `wb_world_tools` (dialog-free ports of vanilla World Editor plugins).
  - W7 Terrain, shapes, generators: `wb_terrain_edit`, `wb_shape`, `wb_generator`.
  - W8 Settings, links, Diag Menu, menus: `wb_settings`, `wb_link`, `wb_diag`, `wb_menu`.
  - W9 Menu toggles: 59 menu paths proven live (toggle and restore) on the `ExecuteAction`
    allow-list that `wb_menu run` and `wb_module action` use.
- **Live safety:** a Workbench lease, a modal watchdog that reports and waits (it never answers the
  authorization prompt), a handler build stamp that warns when the loaded handlers differ from the
  server's bundle, an opened-project check, an `ExecuteAction` deny list and allow-list.
- `-scriptAuthorizeAll` on every Workbench launch, windowed or headless
  (`ENFUSION_NO_SCRIPT_AUTHORIZE_ALL=1` opts out).

### Changed

- **Default tool list.** Without `ENFUSION_TOOLSET`, a client sees the 26 core tools, not the 1.x list.
  Set `ENFUSION_TOOLSET=extended` (137 tools) or `all` (150, aliases included) to keep 1.x tools such
  as `scenario_*`, `refactor_*` and `logs_filter` visible.
- **13 1.x tools are aliases**, listed only under `all`: `wb_entity_create`, `wb_entity_delete`,
  `wb_entity_inspect`, `wb_entity_list`, `wb_entity_modify`, `wb_entity_select` (to `wb_entity` and
  `wb_view`), `wb_save` and `wb_open_resource` (to `wb_module`), `wb_reload` and
  `wb_validate_scripts` (to `wb_scripts`), `wb_execute_action` (to `wb_menu run`),
  `particle_inspect` (to `particle`), `terrain_navmesh_status` (to `wb_navmesh status`). A 1.x
  argument with no equivalent is refused with `INVALID_ARGUMENT` naming the tool to use.
- `wb_save` without `confirm: true` is a dry run; `wb_save` with `path` (Save As) is refused.
- `wb_open_resource` opens the module that owns the file type, not always the World Editor.
- Offline writers replace files by write-then-rename (falling back to an in-place write when
  Workbench holds the file open) and keep numbered backups (`.bak`, `.bak2`, ...). Since the Phase 7
  audit this covers every CST editor (`project_settings`, `animation_*`, `procanim`, `behavior_tree`,
  `audio`, `particle`, `navmesh`) and the `.bak` writer of `scenario_apply_template` and
  `scenario_clone_area`.
- `layout_create` refuses a `projectPath` outside the configured project root, and `script_format`
  refuses a `.c` outside the project and workshop roots.
- `wb_container describe` cursors are `<offset>:<total>`; a changed total answers `STALE_CURSOR`.
- `wb_world` write failures answer `SAVE_FAILED`.
- A stale Workbench lease no longer refuses `wb_launch`, `wb_connect` or headless runs.
- The server version is read from `package.json`.

### Changed by the Phase 7 audit fixes (DEC-107)

- **Offline editors stay inside the project root.** `config_edit`, `layout_edit`, `string_table`,
  `imageset`, `meta_file`, `project_settings`, `animation_set`, `animation_workspace`,
  `animation_graph`, `procanim`, `behavior_tree`, `audio`, `particle` and `navmesh` refuse a
  `projectPath` outside `ENFUSION_PROJECT_PATH` with `NOT_IN_PROJECT`, reads included. Any project
  folder under that root is still taken. A workshop or core addon folder is no longer a valid
  `projectPath` for these tools.
- `prefab inspect` reads only relative `.et` paths with no `..`, and never outside the project or game
  data. `game_duplicate` refuses a `sourcePath` that is not a relative `.et` or `.conf`, and a
  `destPath` that changes the extension.
- `behavior_tree create` with `overwrite: true` and `edit` keep a numbered backup (`.bak`, `.bak2`, ...).
- **Project index schema v4.** A resource's GUID now comes from its `.meta` sidecar (a `.gproj` keeps
  its `GUID` property); the `.et` root `ID` is the entity ID and is stored apart. Every file with a
  `.meta` is indexed, binaries included. The upgrade drops the old rows and re-crawls: until the first
  crawl ends, `resolve_guid`, `find_references` and the `refactor_*` tools see an empty index, and on a
  large addons folder the server can be slow to answer its first `tools/list`. Rows of deleted files are
  removed on every crawl; the watcher also reacts to `.meta` edits.
- Fixed by schema v4: `resolve_guid`, `find_broken_refs` and `refactor_move_resource_path` on prefabs
  that share an entity ID; `find_unused_resources` no longer lists `.gproj` files or unparsed
  resources; `refactor_replace_guid`'s collision check also walks the disk for a `.meta` claiming the
  new GUID; `refactor_move_resource_path` also rewrites text files the index does not parse;
  `refactor_merge_duplicate_guids` reads only `.gproj` GUIDs and `.meta` names; `asset_orphan_scan`
  reads every parsed text file; `project_index_status` counts each project's own resources.
- **`wb_launch` never starts a second Workbench.** It refuses (`LAUNCH_FAILED`) when a Workbench is
  running but not answering, and with `gprojPath` it refuses (`LAUNCH_MISMATCH`) when the running
  Workbench has another project loaded. The 1.x standalone-addon cleanup never removes the project being
  launched, and keeps a standalone `EnfusionMCP` addon that holds anything beyond the generated 1.x
  files (it used to delete a user project at `<projectPath>/EnfusionMCP`).
- `wb_cli_run` with `AddonBuildInfoTool` requires `addonPath` to be the project folder and `ciInfoDst`
  an absolute `.json` file under the artifacts folder.
- **`ENFUSION_PROJECT_PATH` means one thing everywhere:** the addons folder, each addon a child folder
  with a `.gproj` (a folder that itself holds a `.gproj` is taken as the addon). The addon is picked by
  `modName`, then `ENFUSION_DEFAULT_MOD`, then the only child addon; several addons with no pick refuse
  `NOT_IN_PROJECT` (`wb_world` offline writers, `wb_terrain_edit`, the `wb_world_tools` CSV import).
  `wb_world saveAs` and `wb_terrain_edit` refuse an open world that belongs to another addon.
- `wb_entity_duplicate` refuses a child entity and deletes the original only after it read the copy
  back at top level and at the original's world position.
- The 1.x world-edit handlers (components add and remove, clipboard cut, paste and duplicate, entity
  create and delete, undo and redo) refuse `NOT_IN_PROJECT` outside the guarded project and
  `WRONG_MODE` in play mode.
- `wb_module action` runs through the same gate as `wb_menu run`: an item that is not marked safe is a
  dry run unless `confirm: true`, and an item ending in `...` (it opens a dialog) refuses
  `MODAL_HAZARD`. `File > Options...` left the allow-list (58 paths).
- `wb_projects open` sends nothing and answers an error: the NET API cannot switch the project of a
  running Workbench. Use `wb_launch gprojPath`.
- `project_validate scope=scenario` accepts the engine's `World` property. `world_diff` matches
  entities on their `ID`, so a moved entity reads as moved. `script_lint rpc_missing_channel` and
  `script_find_rpc_handlers` (by default) match `RplRpc`.
- Values set in a config file are no longer overwritten by the derived defaults (`gamePath`,
  `corePath`, `workshopPath`, `logsPath`, `gameLogsPath`, `patternsDir`).
- `asset_search` also reads the EntityCatalog configs inside the paks and prints the full
  `{GUID}path`; `refresh: true` also rebuilds the pak tree.
- `terrain_inspect` refuses when `world_path` is not the world open in the World Editor; the handler's
  answer names the world it read (`open_world`).
- The build-stamp mismatch warning says to restart Workbench through `wb_launch`; a running Workbench
  is not reinstalled into.

### Removed

- The `save` action of the `EMCP_WB_EditorControl` handler is retired: it saved any open world with no
  guard. It answers an error naming `wb_module save`. `wb_save` routes to `wb_module save`.
- Two 1.x entity handlers removed after the W1 battery passed; their tools are aliases now.

### New refusals

- `NOT_IN_PROJECT`: no single loaded project carries the handler set, or the target is not an existing
  file inside it.
- `ABSOLUTE_PATH`: live write targets must be project-relative.
- `NOT_ALLOWLISTED`: a menu path, command line or plugin that is not on its allow-list.
- `GATED`: an action that is built but not proven live (see "Not proven" below).
- `ENGINE_FALSE`: `wb_view setVisible` and `placeAtPixel` refuse when no undo point opens.
- `LEASE_HELD`: another session holds the Workbench lease.
- `meta_file setAncestor` refuses a platform cycle; `audio create` refuses to overwrite a file of
  another kind; `wb_settings` refuses escaped spellings of `NetAPI_`, `ScriptDebugMode` and
  authorization keys.

### Not proven, gated

- **Terrain writes** (`wb_terrain_edit`): reads proven live; no write is proven and every write is
  `GATED`.
- **Plugin runs** (`wb_plugin run`): three classes are on the run allow-list (DEC-103) and were run
  live with no dialog and the sandbox unchanged: `CameraOrientationTool` (World Editor),
  `SCR_LocLengthPlugin` (Localization Editor, needs an open string table) and
  `SCR_CheckRuinModelsAndUsagePlugin` (Resource Manager). Every other class refuses `NOT_ALLOWLISTED`.
- **GUI drive** (`wb_gui invoke`, `expand`, `setValue`): `GATED`; no GUI row is enabled.
- **Particle Editor**: not opened by any tool (it crashed Workbench in a probe); `wb_particle`
  previews in the World Editor instead.
- `script_lsp` needs `LSP_Enabled=1` in the Workbench ini; untested live without it.
- 48 further menu paths are candidates, not shipped; `Window > Manage Layouts` opens a dialog and is
  on neither list.

### Known issues

- Workbench 1.9.0.37 can crash during its own exit (Crash Reporter, access violation in Qt code) after
  Resource Manager sub-editor tabs were read with `wb_gui tree`. Intermittent; seen only after an
  imageset, layout or styles tab (possibly with others) was opened and read in the session, never after
  material, model or texture tabs alone. No data lost in seven occurrences. Close imageset, layout and
  styles tabs by hand before exiting. Details: [docs/RELEASE-NOTES-2.0.md](./docs/RELEASE-NOTES-2.0.md).

## 1.x updates after 1.0.0 (published 2026-07 to 2026-09, version left at 1.0.0)

- Reforger Tools 1.7 (`stable_1_87_80`) and 1.8 (`stable_1_88_80`, 1.8.0.13 hotfix) absorbed; the 1.8
  pak generation is read (absolute offsets, zlib wrapper).
- Launcher watchdog and dependency pre-flight on every launch path.
- Headless tools refuse to spawn while Workbench runs, and spawn with the game install as working
  directory.
- An audit fix pass (2026-09-02) over the handlers, socket and launch races, the script parser and the
  project index (schema v3).

## 1.0.0 (2026-05-21)

112 tools. (The project became a standalone repository on 2026-08-09.)
