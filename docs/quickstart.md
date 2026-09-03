# Quickstart — v1.0.0

This guide gets the Enfusion-Workbench-MCP-Goldwep MCP server running locally and registered with Claude Code. v1.0.0 ships **112 tools** (counted via `grep -r "server.registerTool(" src/tools`) spanning offline read tools, live Workbench control, project-wide refactor, scenario authoring, log inspection, and dedicated-server lifecycle.

## Prerequisites

- **Node 20+** (Node 24 is what this repo is built and tested against).
- **Arma Reforger Tools** installed via Steam — needed for `mod` (`action=build`) and all `wb_*` live tools.
- **Arma Reforger** (the game, Steam app `1874900`) **only if** you want to use the `server_*` cluster — the dedicated server ships with the game install, not the tools install.
- A Workbench project at `Documents\My Games\ArmaReforgerWorkbench\addons\` (or wherever you point `ENFUSION_PROJECT_PATH`).
- Working directory: `C:\Users\<you>\Documents\GitHub\Enfusion-Workbench-MCP-Goldwep\`.

## 1. Install and build

```bash
npm install
npm run build
npm test
```

You should see ~1036 tests passing (1 intentionally skipped — see `docs/CONVENTIONS.md`). If a build fails on `better-sqlite3`, the prebuild didn't match your Node version — use Node 20-22 or Node 24+ (12.x has Node 24 prebuilds).

## 2. Seed the project-index DB

The MCP server creates the project-index DB lazily on first use, but you can also seed it ahead of time with the bundled smoke script:

```bash
npx tsx scripts/smoke.ts
```

This crawls your project directory (defaults to `~/Documents/My Games/ArmaReforgerWorkbench/addons`) and writes the project-index to `~/.enfusion-mcp/project-index.db`. Output looks like:

```
[smoke] project path:  C:\Users\<you>\Documents\My Games\ArmaReforgerWorkbench\addons
[smoke] index DB path: C:\Users\<you>\.enfusion-mcp\project-index.db

=== Crawl result ===
Projects found:        1
Projects indexed:      1
Files scanned:         3
Files skipped:         0
Resources upserted:    3
```

Override paths via env vars if your setup differs:
- `ENFUSION_PROJECT_PATH` — where your addons live.
- `ENFUSION_PROJECT_INDEX_PATH` — where to write the DB.

## 3. Register the MCP server with Claude Code

Add this entry to your `~/.claude/settings.json` under the `mcpServers` key:

```json
{
  "mcpServers": {
    "enfusion-workbench-mcp-goldwep": {
      "command": "node",
      "args": [
        "C:\\Users\\<you>\\Documents\\GitHub\\Enfusion-Workbench-MCP-Goldwep\\dist\\index.js"
      ],
      "env": {
        "ENFUSION_PROJECT_PATH": "C:\\Users\\<you>\\Documents\\My Games\\ArmaReforgerWorkbench\\addons",
        "ENFUSION_WORKBENCH_PATH": "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Arma Reforger Tools"
      }
    }
  }
}
```

Restart Claude Code and verify with `/mcp` — `enfusion-workbench-mcp-goldwep` should be listed.

> This fork is not yet published to npm. Reference the built `dist/index.js` directly rather than going through `npx`.

## 4. Tool clusters at v1.0.0

Per-cluster documentation lives alongside this file:

- **Script tooling (7 tools)** — `docs/TOOLS-SCRIPT.md`. `script_analyze`, `script_overrides`, `script_lint`, `script_format`, `script_class_hierarchy`, `script_extract_interface`, `script_find_rpc_handlers`.
- **Terrain (3 tools)** — `docs/TOOLS-TERRAIN.md`. `terrain_inspect`, `terrain_navmesh_status`, `terrain_road_export_graph`. **L7 placeholders** for navmesh/road; require the EMCP_WB_Terrain.c Enforce handler wired beyond the current scaffold (`getHeight` / `getBounds` / `inspect` work today).
- **Refactor (6 tools)** — `docs/TOOLS-REFACTOR.md`. `refactor_replace_guid`, `refactor_move_resource_path`, `refactor_rename_project_id`, `refactor_normalize_dependencies`, `refactor_remove_unused`, `refactor_merge_duplicate_guids`.
- **Scenario + faction** — `docs/TOOLS-SCENARIO.md`. `scenario_create`, `scenario_create_conflict`, `scenario_inspect`, `scenario_diff`, `scenario_clone_area`, `scenario_apply_template`, `gm_spawn_list_export`, `faction_create`, `faction_list_units`, `project_validate scope=faction`.
- **Animation (3 tools)** — `docs/TOOLS-ANIMATION.md`. `animation_graph`, `animation_find_unused_clips`, `weapon_pose_lint`. `project_validate scope=anim` is not yet shipped.

Plus the upstream-inherited surface (~45 tools): `api_search`, `wiki_search`, `wb_*` live Workbench cluster, `mod`, `prefab`, `script_create`, `config_create`, `layout_create`, `game_browse`, `game_read`, `asset_search`, `workshop_info`, etc. — see `README.md` for the inherited tool tables.

## 5. EMCP handler deployment (L7 live Workbench tools)

Tools that talk to Workbench over the NET API (`wb_*` and the L7 `terrain_*` cluster) need handler scripts installed inside the active mod's `Scripts/WorkbenchGame/EnfusionMCP/` directory.

**`wb_launch` handles this automatically.** When called with a `gprojPath`, it:

1. Copies the bundled handler `.c` files from `mod/Scripts/WorkbenchGame/EnfusionMCP/` into `<modDir>/Scripts/WorkbenchGame/EnfusionMCP/`.
2. Spawns `ArmaReforgerWorkbenchSteamDiag.exe` with the project loaded.
3. Polls the NET API on port 5775 until it responds (or times out).

```jsonc
// Example wb_launch call
{ "gprojPath": "C:/.../addons/MyMod/MyMod.gproj" }
```

Once `wb_launch` returns "Workbench Ready", every `wb_*` and `terrain_*` tool routes through the deployed handlers.

**Always call `wb_cleanup` before publishing** the mod to remove the dev-handler scripts:

```jsonc
{ "modDir": "C:/.../addons/MyMod" }
```

`workshop_validate_manifest` is wired to refuse publish if the EnfusionMCP handler directory is still present — a safety net for forgotten cleanups. The handlers compile inside the user's mod as if they were part of it; shipping them would clutter the workshop addon with dev infrastructure (and would violate the cleanliness rule that drove the fork's wb_cleanup pattern).

## 6. Byte-edit safety reminder (L4 / L5 refactors)

Tools that rewrite project files — the entire L5 refactor cluster, plus `script_format`, `scenario_clone_area`, `scenario_apply_template`, `faction_create` — share a four-rule safety doctrine:

1. **Dry-run by default.** Every commit-shaped tool defaults `commit: false` (or `dry_run: true`). The tool returns a readable plan; the human flips the flag to write.
2. **`.bak` sidecars on every committed file.** `atomicCommit` (`src/refactor/byte-edit.ts:438`) writes each pre-state to `<file>.bak` before the new content lands. Mid-write failure rolls every file back from its sidecar.
3. **Git-clean refuse.** Tools check `git status` on every target. Uncommitted local changes refuse the commit unless `force: true`. Prevents an LLM from compounding edits on top of unreviewed work.
4. **No-op detection.** Empty plans, identical old/new values, and missing targets render as informational responses — not errors. Tools fail soft so an LLM doesn't loop on a refactor that's already done.

Full doctrine + per-tool guidance: `docs/TOOLS-REFACTOR.md`.

## 7. L5 refactor workflow — which tool for which task

| Goal                                                              | Tool                                |
|-------------------------------------------------------------------|-------------------------------------|
| Issue a fresh GUID for a resource and update every ref            | `refactor_replace_guid`             |
| Move a resource into a subdirectory                               | `refactor_move_resource_path`       |
| Rename a `.gproj`'s `ID` field                                    | `refactor_rename_project_id`        |
| Clean up a `.gproj`'s Dependencies block (sort, dedupe, validate) | `refactor_normalize_dependencies`   |
| Generate a delete-script for orphan files                         | `refactor_remove_unused` (compose with `find_unused_resources`) |
| Diagnose duplicate-GUID collisions after a Workshop fork          | `refactor_merge_duplicate_guids`    |

Typical "fork a mod, rename it, clean up" sequence: `refactor_merge_duplicate_guids` → `refactor_replace_guid` per collision → `refactor_rename_project_id` → `refactor_normalize_dependencies` → `find_unused_resources` → `refactor_remove_unused`.

## 8. Server cluster (L8)

Five tools manage the dedicated server lifecycle. **Requires Arma Reforger (the game, Steam app `1874900`)** — the dedicated server binary ships with the game install, separate from the tools install used by `wb_*`.

| Tool                       | What it does                                                                                                       |
|----------------------------|--------------------------------------------------------------------------------------------------------------------|
| `server_launch`            | Spawn `ArmaReforgerServer.exe` with a server.json + scenarioId. **Always defaults `dry_run: true`** — prints the argv + a redacted config view but does not spawn unless explicitly `dry_run: false`. Passwords never echoed. |
| `server_stop`              | Terminate a server previously launched by `server_launch` (same server.json). Reads the PID file, SIGTERM with timeout, falls back to force-kill. |
| `server_health_probe`      | UDP Valve A2S info query against `host:query_port`. Reports player count, map, name, version. Anonymous, read-only. |
| `server_mod_list`          | List the mods a server.json references and resolve them against the project-index.                                 |
| `server_scenario_picker`   | List scenarios available to a server.json from the indexed projects.                                               |

Plus `server_validate_config` (L3) and `server_config` (upstream — generates a fresh `server.json` skeleton).

A typical local-server smoke run: `server_validate_config` → `server_launch` (dry-run, eyeball argv) → `server_launch` (`dry_run: false`) → `server_health_probe` until it responds → ... iteration ... → `server_stop`.

## 9. Configuration reference

| Env var                       | Description                                              | Default                                                              |
|-------------------------------|----------------------------------------------------------|----------------------------------------------------------------------|
| `ENFUSION_WORKBENCH_PATH`     | Path to Arma Reforger Tools install                      | `C:\Program Files (x86)\Steam\steamapps\common\Arma Reforger Tools`  |
| `ENFUSION_PROJECT_PATH`       | Default addons folder                                    | `~/Documents/My Games/ArmaReforgerWorkbench/addons`                  |
| `ENFUSION_GAME_PATH`          | Path to the Arma Reforger game install                   | Auto-derived from sibling of `ENFUSION_WORKBENCH_PATH`               |
| `ENFUSION_WORKBENCH_HOST`     | NET API host                                             | `127.0.0.1`                                                          |
| `ENFUSION_WORKBENCH_PORT`     | NET API port                                             | `5775`                                                               |
| `ENFUSION_PROJECT_INDEX_PATH` | Project-index DB file                                    | `~/.enfusion-mcp/project-index.db`                                   |
| `ENFUSION_DEFAULT_MOD`        | Default mod folder name                                  | (unset; runtime-derived from `wb_launch`)                            |
| `ENFUSION_MCP_DEBUG`          | Enable `logger.debug` output                             | (unset)                                                              |

JSON-file config (alternative to env vars):
- Repo-local: `<repo>/enfusion-mcp.config.json`
- User: `~/.enfusion-mcp/config.json`

Env vars override files; files override defaults.

## 10. Try the new tools

Once registered, ask Claude:

- _"Use `project_index_status` to show me what's indexed."_
- _"Use `resolve_guid` to look up `{A9806AF617972E97}`."_ (Arland world GUID)
- _"Use `find_references` to list all references to `{58D0FB3206B6F859}`."_ (the Reforger game module — Test1 and any other addon depending on it will appear)
- _"Use `script_overrides` against my addon to find every `modded class` declaration."_
- _"Use `refactor_merge_duplicate_guids` to scan for collision after I forked this mod."_

## 11. Troubleshooting

| Symptom                                          | Likely cause                                            | Fix                                                              |
|--------------------------------------------------|---------------------------------------------------------|------------------------------------------------------------------|
| `project_index_status` shows zero projects       | Smoke not run, or `ENFUSION_PROJECT_PATH` is wrong      | Run `npx tsx scripts/smoke.ts`                                   |
| `find_references` returns "no references found"  | Target GUID's referrer is in an unindexed project       | Add the addon root to the crawl source set (env / config)        |
| Build fails on `better-sqlite3`                  | Node version mismatch with the prebuild                 | Use Node 20-22 or Node 24+ (12.x has Node 24 prebuilds)          |
| MCP server doesn't appear in `/mcp`              | `dist/index.js` doesn't exist                           | Run `npm run build`                                              |
| `wb_*` tools fail with `CONNECTION_REFUSED`      | Workbench not running or NET API disabled               | Open Workbench, File → Options → General → enable Net API        |
| `terrain_*` tools return "EMCP handler not deployed" | Handler `.c` wasn't copied to the mod's Scripts/    | Call `wb_launch` with the mod's `gprojPath` to install it        |
| `terrain_navmesh_status` returns "not yet implemented" | L7 placeholder — handler dispatcher wired, action body not | Track `docs/L7-PLAN.md` §L7-1                              |
| `server_launch` says "Steam app 1874900 required" | The dedicated server binary isn't installed             | Install Arma Reforger (the game, separate from the tools)        |
