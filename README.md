# Enfusion Workbench MCP

MCP server for Arma Reforger / Enfusion Workbench modding. Describe what you want to build, and Claude handles the rest — API research (8,971 indexed classes), code generation, project scaffolding, project-wide indexing and refactoring, live Workbench control, and in-editor testing.

Originally derived from [`steffenbk/enfusion-mcp-BK`](https://github.com/steffenbk/enfusion-mcp-BK) (MIT) and since grown into a standalone project — see [Credits](#credits) and [docs/FORK-NOTES.md](./docs/FORK-NOTES.md) for lineage.

**112 tools · 4 guided prompts · 3 MCP resources · 1,000+ tests**

## Install

Clone and build (the reliable path):

```bash
git clone https://github.com/Goldwep/enfusion-workbench-mcp.git
cd enfusion-workbench-mcp
npm install
npm run build
```

### Claude Code

```bash
claude mcp add --scope user enfusion-mcp -- node <absolute-path-to-repo>/dist/index.js
```

Restart Claude Code. Verify with `/mcp`.

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "enfusion-mcp": {
      "command": "node",
      "args": ["<absolute-path-to-repo>/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop. Verify with `/mcp`.

### Workbench handler scripts

The live Workbench tools (`wb_*`) require handler scripts running inside Workbench. These ship in `mod/Scripts/WorkbenchGame/EnfusionMCP/` and are installed automatically when Claude launches Workbench via `wb_launch`.

The `EMCP_WB_*.c` handlers use the documented Arma Reforger / Enfusion Workbench plugin API surface only (`JsonApiStruct`, `NetApiHandler`, `Workbench.GetModule`, etc.) and ship as dev-time scaffolding — `wb_cleanup` removes them before publish, and `workshop_validate_manifest` refuses publish if they're still present. See [docs/FORK-NOTES.md](./docs/FORK-NOTES.md) for the Bohemia Interactive tools-EULA compliance review.

## Usage

Just ask Claude to make a mod:

- _"Create a HUD widget that shows player health and stamina"_
- _"Make a zombie survival game mode with wave spawning"_
- _"Find every reference to this prefab GUID across my mods"_
- _"Rename this resource and update everything that points at it"_
- _"Set up a Conflict scenario on Everon with three bases"_

Or use the guided prompts:

| Prompt | Description |
| --- | --- |
| `/create-mod` | Full guided mod creation — from idea to built addon |
| `/modify-mod` | Modify or extend an existing mod project |
| `/mission_setup` | Step-by-step mission/scenario scaffold (template, factions, validation) |
| `/character_anim_pipeline_guide` | Character animation pipeline explainer (skeleton → AGR → ASI → AGF → clips) |

## Tools

### Offline authoring (no Workbench needed)

| Tool | What it does |
| --- | --- |
| `api_search` | Search 8,971 Enfusion/Arma Reforger API classes and methods — inherited members, enum-like class detection, related siblings, `format: 'tree'` ASCII hierarchy |
| `component_search` | Search ScriptComponent descendants — filter by category (character, vehicle, weapon, damage, inventory, ai, ui, …) and event handlers |
| `wiki_search` / `wiki_read` | Search and read 274 pre-downloaded tutorials and guides from the Enfusion docs and BI Community Wiki |
| `wb_knowledge` | Search the bundled modding knowledge base — distilled patterns for scripting, audio, weapons, vehicles, AI, UI, game modes, animation, and more |
| `project` | Browse / read / write files in a mod project directory |
| `mod` | Scaffold a new addon, validate it, or build it via the Workbench CLI |
| `script_create` | Generate Enforce Script (`.c`) — 7 types; auto-fetches overridable parent methods from the API index |
| `prefab` | Create or inspect Entity Template (`.et`) prefabs — inspect merges the full inheritance chain so you see where every value comes from |
| `layout_create` | Generate UI layout (`.layout`) files — hud, menu, dialog, list, custom |
| `config_create` | Generate config files — factions, mission headers, entity catalogs, editor placeables |
| `server_config` | Generate a dedicated-server `server.json` for local testing |

### Base-game access

| Tool | What it does |
| --- | --- |
| `game_browse` / `game_read` | Browse and read base-game files — loose files and `.pak` archives transparently |
| `asset_search` | Search game assets by name across loose files and `.pak` archives |
| `game_duplicate` | Duplicate a base-game prefab/config into your mod with a fresh GUID |
| `workshop_info` | Read Workshop metadata from a mod's `.gproj` |
| `animation_graph` | Unified vehicle animation-graph tool — inspect, author, validate |
| `building_setup` | Set up a destructible building from a Blender export manifest |

### Project index & reverse queries

A SQLite-backed index crawls your mods, workshop subscriptions, and the base game, and keeps itself fresh with a file watcher.

| Tool | What it does |
| --- | --- |
| `resolve_guid` | Any 16-hex GUID → defining file, type, class, inheritance parent |
| `find_references` | Paginated list of every file referencing a GUID, filterable by kind |
| `project_index_status` | Index snapshot — resources, refs, files, per-project counts |
| `find_unused_resources` | Resources with zero inbound references (pre-publish cleanup) |
| `find_broken_refs` | References to GUIDs that don't exist (ship-blocker check) |
| `inheritance_chain` | Walk a prefab's parent chain to the root; flags cycles |
| `list_resources` | Paginated browse, filter by source / root type / project |
| `list_dependencies` | A project's declared dependencies with each GUID resolved |

### Logs, world & workshop inspection

| Tool | What it does |
| --- | --- |
| `logs_list` / `logs_tail` / `logs_filter` / `logs_summarize_errors` | Inspect Workbench and game log sessions — crash detection, error-signature grouping, regex filtering |
| `world_compose_summary` / `world_validate_refs` / `world_diff` | World-file analysis — composition summary, broken-ref check, semantic diff |
| `scenario_inspect` / `scenario_diff` | Mission/scenario `.conf` inspection and comparison |
| `workshop_validate_manifest` / `workshop_check_deps` | Pre-publish checks — manifest completeness, dependency resolution, dev-handler leak guard |
| `wb_validate_scripts` / `wb_cli_run` / `wb_build_data` | Headless Workbench CLI wraps — compile check, curated CLI commands, data build |
| `server_validate_config` / `project_validate` | server.json schema validation (secrets redacted); consolidated mod/scenario/faction lint |

### Asset inspection

| Tool | What it does |
| --- | --- |
| `material_inspect` / `material_diff` / `material_find_unused_textures` | `.emat` analysis — texture slots, parameters, unused-texture scan |
| `ui_layout_inspect` / `ui_layout_validate` / `ui_extract_strings` / `ui_styles_inspect` / `ui_localization_audit` | UI layout and localization analysis |
| `particle_inspect` / `asset_orphan_scan` | Particle effect inspection; generalized orphaned-asset scan |

### Refactoring

Surgical byte-level edits — never parse-and-rewrite. Every write leaves a `.bak` sidecar, refuses on uncommitted git changes unless forced, and defaults to dry-run where destructive.

| Tool | What it does |
| --- | --- |
| `refactor_replace_guid` | Replace a GUID everywhere it appears, index-driven |
| `refactor_move_resource_path` | Move/rename a resource file and update every reference |
| `refactor_rename_project_id` | Rename a project's ID in its `.gproj` |
| `refactor_normalize_dependencies` | Sort, dedupe, and validate a Dependencies block |
| `refactor_merge_duplicate_guids` | Diagnose GUID collisions across projects |
| `refactor_remove_unused` | Emit a reviewed deletion script for orphaned resources (dry-run) |

### Enforce Script analysis

A hand-rolled Enforce Script parser drives static analysis without needing Workbench.

| Tool | What it does |
| --- | --- |
| `script_analyze` | File → AST: classes, modded classes, methods, attributes |
| `script_overrides` | Find every `modded class` chain for a base class |
| `script_lint` / `script_format` | Style lint (BI conventions) and safe-subset formatter |
| `script_class_hierarchy` | Join engine API hierarchy with your modded chains — ASCII tree |
| `script_extract_interface` | Emit a class's public surface as markdown |
| `script_find_rpc_handlers` | Locate `[RPC]`-attributed methods across a project |

### Scenario, faction & server management

| Tool | What it does |
| --- | --- |
| `scenario_create` / `scenario_create_conflict` | Author scenario elements live in Workbench, or generate a complete Conflict MP scenario file-set |
| `scenario_clone_area` | Clone a rectangular area of a layer with regenerated GUIDs |
| `scenario_apply_template` | Stamp curated templates (FOB, checkpoint, patrol grid) at a position |
| `faction_create` / `faction_list_units` | Scaffold faction configs; group a project's units by faction |
| `gm_spawn_list_export` | Export the Game Master spawn catalog as a per-faction table |
| `animation_find_unused_clips` / `weapon_pose_lint` | Animation hygiene — unused clips, missing standard weapon tags |
| `server_launch` / `server_stop` | Managed dedicated-server lifecycle — PID tracking, dry-run default |
| `server_mod_list` / `server_scenario_picker` / `server_health_probe` | server.json mod resolution, scenario catalog, live A2S query |

### Live Workbench control

Control a running Workbench over its NET API (TCP). Handler scripts are installed automatically by `wb_launch`.

| Tool | What it does |
| --- | --- |
| `wb_launch` / `wb_cleanup` | Start Workbench with handlers installed; remove handlers before publish |
| `wb_connect` / `wb_diagnose` / `wb_state` | Connection test, full diagnostic, editor state snapshot |
| `wb_play` / `wb_stop` / `wb_save` / `wb_undo_redo` / `wb_reload` | Editor lifecycle — play mode, save, undo/redo, script reload |
| `wb_open_resource` / `wb_execute_action` | Open any resource in its editor; run any menu action by path |
| `wb_entity_create` / `wb_entity_delete` / `wb_entity_list` / `wb_entity_inspect` / `wb_entity_modify` / `wb_entity_select` / `wb_entity_duplicate` | Full entity CRUD — create from prefab, inspect components, move/rotate/rename/reparent, property get/set, duplicate locked base-game instances into your mod |
| `wb_component` | Add, remove, list entity components |
| `wb_terrain` | Terrain height at a coordinate; world bounds |
| `wb_layers` / `wb_resources` / `wb_prefabs` | Layer queries, resource registration/info, prefab templates + GUID lookup |
| `wb_clipboard` / `wb_script_editor` / `wb_localization` / `wb_projects` | Clipboard ops, Script Editor line access, string-table CRUD, project management |
| `wb_validate` | Material/texture validation via Workbench's built-in validators |
| `terrain_inspect` / `terrain_navmesh_status` / `terrain_road_export_graph` | Terrain analysis — bounds and stats live; navmesh/roads are placeholder pending handler wiring (see [docs/L7-PLAN.md](./docs/L7-PLAN.md)) |

### Mod patterns

10 built-in templates for scaffolding:

`game-mode` `custom-faction` `custom-action` `spawn-system` `custom-component` `modded-behavior` `admin-tool` `custom-vehicle` `weapon-reskin` `hud-widget`

### MCP resources

| URI | Description |
| --- | --- |
| `enfusion://class/{className}` | Full class docs with inheritance, methods, ancestors/descendants |
| `enfusion://pattern/{patternName}` | Mod pattern definition with all templates |
| `enfusion://group/{groupName}` | API group with class list |

## Configuration

All optional — sensible defaults are used when nothing is set.

| Environment variable | Description | Default |
| --- | --- | --- |
| `ENFUSION_PROJECT_PATH` | Mod projects directory (crawled as the `user` source) | `~/Documents/My Games/ArmaReforgerWorkbench/addons` |
| `ENFUSION_WORKBENCH_PATH` | Arma Reforger Tools install | `C:\Program Files (x86)\Steam\steamapps\common\Arma Reforger Tools` |
| `ENFUSION_GAME_PATH` | Arma Reforger game install (used for base-game data access and as CWD when launching Workbench) | Auto-derived as a sibling of the Tools path |
| `ENFUSION_WORKSHOP_PATH` | Workshop addons directory (crawled as the `workshop` source) | Auto-derived from the project path |
| `ENFUSION_CORE_PATH` | Base-game core addons (crawled read-only as the `core` source) | Auto-derived from the Tools path |
| `ENFUSION_PROJECT_INDEX_PATH` | SQLite project-index location | `~/.enfusion-mcp/project-index.db` |
| `ENFUSION_LOGS_PATH` | Workbench log sessions directory | Auto-derived from the project path |
| `ENFUSION_GAME_LOGS_PATH` | Game log sessions directory | Auto-derived from the project path |
| `ENFUSION_EXTRACTED_PATH` | Optional pre-extracted game-data library (checked before `.pak` fallback) | unset |
| `ENFUSION_MCP_DATA_DIR` | Override the bundled data directory | bundled `data/` |
| `ENFUSION_DEFAULT_MOD` | Default addon folder name for tools that take a mod context | set automatically by `wb_launch` |
| `ENFUSION_WORKBENCH_HOST` | Workbench NET API host | `127.0.0.1` |
| `ENFUSION_WORKBENCH_PORT` | Workbench NET API port | `5775` |

Config can also be loaded from `~/.enfusion-mcp/config.json`. Environment variables take priority.

## Requirements

- **Node.js 20+**
- **Arma Reforger Tools** (Steam) — needed for `mod` builds and all `wb_*` tools

## Documentation

| Doc | Contents |
| --- | --- |
| [docs/quickstart.md](./docs/quickstart.md) | Install → build → register → first mod walkthrough |
| [docs/ENFUSION-FORMAT-NOTES.md](./docs/ENFUSION-FORMAT-NOTES.md) | Field notes on the Enfusion text-format grammar — GUID encodings, vector forms, serializer rules |
| [docs/WORKBENCH-OPERATIONS.md](./docs/WORKBENCH-OPERATIONS.md) | Driving a live Workbench — handler lifecycle, NET API pitfalls, recovery |
| [docs/UPDATE-PLAYBOOK.md](./docs/UPDATE-PLAYBOOK.md) | Maintainer checklist for absorbing game updates — re-scrape, GUID re-verify, live re-tests |
| [docs/TOOLS-*.md](./docs) | Per-cluster tool references (script, terrain, refactor, scenario, animation) |
| [docs/CONVENTIONS.md](./docs/CONVENTIONS.md) | Code style guide for contributors |
| [docs/FORK-NOTES.md](./docs/FORK-NOTES.md) | Divergence from upstream + BI tools-EULA compliance review |
| [docs/ERROR-UX.md](./docs/ERROR-UX.md) | Per-tool error-state reference |

## Development

```bash
git clone https://github.com/Goldwep/enfusion-workbench-mcp.git
cd enfusion-workbench-mcp
npm install
npm run scrape   # Rebuild the API index from your Workbench install's docs
npm run build
npx vitest run --pool=forks --poolOptions.forks.singleFork   # 1,000+ tests (counts: npx tsx scripts/count-inventory.ts)
```

See [contributing.md](./contributing.md) for contribution guidelines.

## Credits

Originally created by [steffenbk](https://github.com/steffenbk) ([enfusion-mcp-BK](https://github.com/steffenbk/enfusion-mcp-BK), MIT). This fork by [Goldwep](https://github.com/Goldwep) adds the project-wide GUID/resource index, reverse-query and refactor clusters, Enforce Script analysis, scenario/faction/server tooling, and an expanded live-Workbench surface.

## License

MIT — see [LICENSE](./LICENSE).
