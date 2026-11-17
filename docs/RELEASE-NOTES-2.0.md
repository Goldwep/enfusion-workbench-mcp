# Release notes: 2.0 (2.0.0-rc.1)

## Release candidate

2.0.0-rc.1 (2026-11-16) is a release candidate. The code and the tools are the 2.0 set, but these
items are not finished:

- **Deny lists are the unsigned seed.** The `ExecuteAction` deny lists in `data/census/policy.json`
  are still the first draft. They have not been regenerated from verified labels or signed off, and 11
  of their 19 labels have been seen in a live run.
- **11 minor audit findings are open** from the 2.0 code audit: 10 wait for a design decision and 1 for
  a handler change.
- **Terrain writes stay closed.** Every `wb_terrain_edit` write refuses with `GATED`; only the reads
  are proven.
- **Workbench can crash on exit** after some Resource Manager sub-editor tabs were read with
  `wb_gui tree`. It is intermittent and no data was lost when it happened (details below).
- **The first start after the upgrade re-crawls the project index.** On a large addons folder that
  takes more than a minute, and the index tools see no resources until it ends.

2.0.0 final follows when the remaining plan items are done.

## About 2.0

2.0 turns the server from a set of 1.x tools into a toolbox that covers the Workbench module by module,
with a census of what each module exposes and a live safety layer around every call that changes
something. It was built and checked against Arma Reforger Tools 1.9.0.37.

The short list of changes is in [CHANGELOG.md](../CHANGELOG.md). This page says what it means for you.

## What you get

- **150 tools** when you set `ENFUSION_TOOLSET=all`: 26 core, 111 extended and 13 aliases of 1.x names.
  Every tool has a generated page in [docs/tools/reference/](tools/reference/index.md).
- **Toolsets.** Many MCP clients slow down or cap long tool lists, so the server lists the 26 core tools
  by default. `ENFUSION_TOOLSET=extended` lists 137, `all` lists 150. `ENFUSION_TOOLS=+name,-name`
  adds or drops single tools.
- **Any project.** The live tools that change files work on the project you have open in Workbench,
  as long as the server's handler scripts are installed in it (`wb_launch` does that). They write only
  files that already exist inside that project, never game or dependency files, and every write is a
  dry run unless you pass `confirm: true`.
- **The census.** `wb_census` answers "what is this menu item, panel, setting or diag option, and how do
  I reach it": the tool and action that act on it, its safety, and why nothing can act on it yet when
  that is the case. The data is in `data/census/`; readable pages are in `data/kb/census/`.
- **Per-module tools**, grouped by the waves that built them: World Editor core (`wb_entity`,
  `wb_view`, `wb_world`); Resource Manager, scripts and string tables; animation, procedural animation
  and behavior trees; audio, particles and navmesh; plugins and world tools; terrain, shapes and
  generators; settings, `enfusion://` links, the Diag Menu and menus; and 59 menu toggles proven live.
- **Offline editors that keep files byte for byte**: configs, layouts, imagesets, `.meta`, `.gproj`,
  string tables, behavior trees, animation sets and workspaces, procedural animation, audio, particles
  and navmesh files.

## What changes if you use 1.x

1. **Your tool list gets shorter unless you set a toolset.** Add `ENFUSION_TOOLSET=all` to the `env` of
   your MCP registration to see every 1.x name, or `extended` to see the 1.x tools that are not aliases.
2. **Thirteen 1.x tools are aliases** of a 2.0 tool and are listed only under `all`. They still answer:
   - `wb_entity_create`, `wb_entity_delete`, `wb_entity_inspect`, `wb_entity_list`,
     `wb_entity_modify`, `wb_entity_select` route to `wb_entity` and `wb_view`;
   - `wb_save` and `wb_open_resource` route to `wb_module`;
   - `wb_reload` and `wb_validate_scripts` route to `wb_scripts`;
   - `wb_execute_action` routes to `wb_menu run`;
   - `particle_inspect` routes to `particle`, `terrain_navmesh_status` to `wb_navmesh status`.

   A 1.x argument that has no 2.0 equivalent is refused with `INVALID_ARGUMENT` and the name of the tool
   to use. Nothing is silently dropped.

3. **`wb_save` is a dry run** until you pass `confirm: true`, and Save As (`path`) is refused.
4. **The old unguarded save is gone.** The `EMCP_WB_EditorControl` handler's `save` saved whatever world
   was open; it now answers an error that names `wb_module save`.
5. **`wb_open_resource`** opens a file in the editor that owns its type, not always the World Editor.
6. **Menu actions run only from an allow-list.** `wb_execute_action`, `wb_menu run` and
   `wb_module action` run a menu path only if it is one of the 59 paths that toggled and restored
   cleanly in a live run. Anything else answers `NOT_ALLOWLISTED`.
7. **New refusals you may meet:** `NOT_IN_PROJECT` (no single open project carries the handlers, or the
   target is not a file inside it), `ABSOLUTE_PATH`, `NOT_ALLOWLISTED`, `GATED` (built, not proven
   live), `ENGINE_FALSE` (for example `wb_view setVisible` when no undo point opens), `LEASE_HELD`
   (another session holds the Workbench), `SAVE_FAILED` with the read-back that failed.
8. **Backups are numbered** (`.bak`, `.bak2`, ...) and an existing backup is never overwritten.
9. **Every launch passes `-scriptAuthorizeAll`.** Set `ENFUSION_NO_SCRIPT_AUTHORIZE_ALL=1` to stop that.

## What is gated or not proven

These are built and refuse with `GATED` (or are not offered) until a live run proves them:

- **Terrain writes.** `wb_terrain_edit` reads are proven on a vanilla world. No terrain write has been
  proven, so every write action refuses.
- **Plugin runs.** `wb_plugin` lists plugins and reads their settings. Three classes are on the run
  allow-list (DEC-103) and were run live with no dialog and the sandbox unchanged:
  `CameraOrientationTool` (World Editor), `SCR_LocLengthPlugin` (Localization Editor, with a string table
  open) and `SCR_CheckRuinModelsAndUsagePlugin` (Resource Manager). `run` refuses every other class.
- **Driving the GUI.** `wb_gui tree`, `find`, `screenshot` and `modals` read the window through UI
  Automation (opt-in, `ENFUSION_GUI=1`, Windows only). `invoke`, `expand` and `setValue` are gated, and
  no GUI row is enabled.
- **The Particle Editor.** No tool opens it: it crashed Workbench in an early probe. `wb_particle`
  previews an effect in the World Editor world and `particle` edits `.ptc` files offline.
- **Script language server.** `script_lsp` needs `LSP_Enabled=1` in the Workbench ini and has not been
  run live without it.
- **Other limits found live:** Script Editor Save answers false; the AudioSystem does not run in edit
  mode; the three graph editors expose no document to save; `wb_settings` writes have no engine check
  yet; Workbench can crash on exit after some sub-editor tabs were read (below).
- **Known issue: intermittent crash on exit after Resource Manager sub-editors were read through `wb_gui`.**
  Workbench 1.9.0.37 can crash during its own exit, after the windows have closed: Crash Reporter opens
  and reports an access violation in Qt code. The crash is intermittent (the same steps exited cleanly in
  one session and crashed in another). It has been seen only in sessions where an imageset, layout or
  styles sub-editor tab (possibly with others) was opened and read with `wb_gui tree`, never after
  material, model or texture tabs alone. The close itself had completed: in the seven occurrences no data
  was lost and no project or world file changed. Until the cause is fixed, close imageset, layout and
  styles tabs by hand before exiting (the tools cannot close them yet). You can dismiss the Crash Reporter
  with Close or Cancel.
- **Handler build stamp.** On connect the server compares the build stamp the loaded handler scripts
  report with the bundle it ships. A mismatch (handlers from another version still loaded in the
  project) is logged as a warning in the server log; calls are not refused. After an update, close
  Workbench and start it again through `wb_launch`, which reinstalls the handlers, before you rely on new
  actions. `wb_launch` does not reinstall into a Workbench that is already running.

## How to update

1. Close Workbench.
2. In your clone: `git pull`, then `npm install` and `npm run build`.
3. Add `ENFUSION_TOOLSET` to the `env` of your MCP registration if you want more than the core tools
   (for example `"env": { "ENFUSION_TOOLSET": "all" }` in the server's entry; Claude Desktop keeps it in
   `claude_desktop_config.json`). If you registered the server in more than one client, change each one.
4. Restart the MCP client. The server runs from `dist/`; a client keeps the old build until it restarts.
   The first start rebuilds the project index (schema v4 takes resource GUIDs from the `.meta` files):
   on a large addons folder the first answer can take more than a minute, and the index tools see no resources
   until that crawl ends.
5. Launch Workbench through `wb_launch` once so the 2.0 handler scripts replace the 1.x ones in your
   project. If the loaded handlers differ from the server's bundle, the server warns and says to
   restart Workbench through `wb_launch`.
6. Before you publish a mod, run `wb_cleanup` as before; `workshop_validate_manifest` still refuses a
   publish with the handler scripts in it.
