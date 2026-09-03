# Fork notes — divergence from steffenbk/enfusion-mcp-BK

This repo is a fork of [`steffenbk/enfusion-mcp-BK`](https://github.com/steffenbk/enfusion-mcp-BK) (MIT). The upstream is the original Enfusion / Arma Reforger MCP server; this fork extends it into a project-wide indexing + refactor + scenario authoring toolkit targeting Arma 4 readiness.

## Why the fork exists

The upstream ships ~45 read-side tools focused on per-call lookups: `api_search`, `wiki_search`, the `wb_*` live Workbench cluster, mod scaffolding, etc. The fork adds a persistent SQLite-backed **project index** that crawls user mods + workshop subscriptions + base-game core, plus a refactor cluster that operates over that index. The shape needed structural divergence rather than feature flags, so a hard fork was the cleaner cut.

Three drivers:

1. **Project-wide GUID/resource index.** The upstream's tooling is per-file. Refactor work (rename a GUID, move a resource path, find every reference) needs a single index spanning every project on disk. The fork ships `~/.enfusion-mcp/project-index.db` with file watchers and reverse-query tools.
2. **Multi-source crawl.** Upstream reads one project at a time. The fork crawls `user`, `workshop`, and `core` sources concurrently with a unified schema, so cross-project queries (`find_references`, `inheritance_chain`, `list_dependencies`) work across the user's full content set.
3. **~70 net-new tools across L1-L8.** Refactor primitives, script analysis, terrain/scenario/faction/animation clusters, server-cluster lifecycle, log inspection — none of which fit cleanly as upstream additions.

## What's been added (L1 - L8)

High-level milestone summary; per-cluster docs under `docs/TOOLS-*.md` enumerate the actual tools.

- **L1 — project-index foundation.** SQLite GUID/resource index, file watcher, paginated query tools (`resolve_guid`, `find_references`, `project_index_status`).
- **L2 — reverse-query cluster.** Built atop the L1 index: `find_unused_resources`, `find_broken_refs`, `inheritance_chain`, `list_resources`, `list_dependencies`.
- **L3 — observability + workshop pre-flight.** `logs_*` cluster, `server_validate_config` with redacted view, `world_*` / `scenario_inspect` / `workshop_validate_manifest`, headless Workbench CLI wraps.
- **L4 — materials + UI + particles + asset-orphan scan.** Cross-cutting validators that didn't have a home in the upstream's per-domain shape.
- **L5 — refactor cluster.** Surgical byte-edit refactors with `.bak` sidecars, git-clean refusals, dry-run defaults: `refactor_replace_guid`, `refactor_move_resource_path`, `refactor_rename_project_id`, `refactor_normalize_dependencies`, `refactor_remove_unused`, `refactor_merge_duplicate_guids`.
- **L6 — script tooling.** Enforce Script mini-parser drives `script_analyze`, `script_overrides`, `script_lint`, `script_format`, `script_class_hierarchy`, `script_extract_interface`, `script_find_rpc_handlers`.
- **L7 — terrain handler architecture.** New `EMCP_WB_Terrain.c` handler skeleton + three live Workbench tools (`terrain_inspect`, `terrain_navmesh_status`, `terrain_road_export_graph`). Inspect is live; navmesh + road export ship as placeholders pending the handler wiring detailed in `docs/L7-PLAN.md`.
- **L8 — scenario authoring + faction + animation + server cluster.** `scenario_clone_area`, `scenario_apply_template`, `faction_create`, `faction_list_units`, `gm_spawn_list_export`, `animation_find_unused_clips`, `weapon_pose_lint`, `server_launch`, `server_stop`, `server_mod_list`, `server_scenario_picker`, `server_health_probe`.
- **L9 — release polish.** Per-cluster docs (this directory), BI attribution review, error UX pass. No new tools.

Total: **112 `registerTool` calls** at v1.0.0 (counted via `grep -r "server.registerTool(" src/tools`).

## What's been kept

- **MIT license.** See `LICENSE` — both upstream copyright and this fork's copyright are listed; the permission grant is unchanged.
- **Upstream attribution.** `README.md` opens with the fork notice and links back to `steffenbk/enfusion-mcp-BK`. The `Credits` section calls out the original maintainer.
- **The ~45 inherited tools.** `api_search`, `component_search`, `wiki_search`, `wiki_read`, the full `wb_*` cluster, `mod`, `prefab`, `script_create`, `config_create`, `layout_create`, `game_browse`, `game_read`, `asset_search`, `workshop_info` — all retained, with minor input-schema additions (e.g. flag-smuggle guards) where the security audit required them.
- **The MCP shape.** `server.registerTool` calls, the `{ content: [{ type: "text", text }], isError? }` response envelope, the `inputSchema` raw-object idiom, MCP prompts and resources — all unchanged from upstream's contract.

## Bohemia Interactive tools-EULA compliance

The `mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_*.c` handler files use the documented Arma Reforger / Enfusion Workbench plugin and NET API surface:

- Each handler subclasses `JsonApiStruct` for request/response messaging and `NetApiHandler` for the dispatch entry point. Both classes are part of the documented engine surface for NET API extensions.
- Handlers call into publicly-documented APIs only: `Workbench.GetModule(WorldEditor)`, `WorldEditorAPI.GetTerrainSurfaceY`, `worldEditor.GetTerrainBounds`, etc.
- No base-game `.pak` content is redistributed. Handler files are pure Enforce Script source written by this project.
- Handlers are not decompiled or reverse-engineered from BI-shipped binaries. They mirror the same shape as any other Workbench plugin.
- The handlers ship as **dev-time scaffolding**, copied into the user's mod project on `wb_launch`. `wb_cleanup` removes them before the user publishes, and `workshop_validate_manifest` is wired to refuse publish if `Scripts/WorkbenchGame/EnfusionMCP/` is still present.

Verdict: tools-EULA compliant. See `LICENSE` for the explicit MIT/derivative provenance.

## How to merge upstream changes back

The recommended pattern is a tracked upstream remote with selective cherry-picks:

```bash
# One-time: add steffenbk as an upstream remote
git remote add upstream https://github.com/steffenbk/enfusion-mcp-BK.git
git fetch upstream

# Per merge cycle:
git fetch upstream
git log --oneline ..upstream/main           # what's new upstream
git cherry-pick <sha>                       # one commit at a time
# Resolve conflicts (most likely in src/server.ts wiring or shared utils)
npm run build && npm test                   # verify nothing regressed
```

Avoid `git merge upstream/main` — the fork's structural changes (project-index integration in `src/server.ts`, the L5+ refactor cluster, new utility modules) make a flat merge noisy. Cherry-pick keeps the commit history readable and lets each upstream patch be tested in isolation.

Hot-spot files where conflicts are most likely:

- `src/server.ts` — fork has ~100 added `register*()` calls and the project-index bootstrap block; upstream additions will need to slot in alongside.
- `src/config.ts` — fork adds `projectIndexPath`, `workshopPath`, `corePath` config keys.
- `package.json` — fork pins additional deps (`better-sqlite3`, `chokidar`); merge upstream's bumps but keep the additions.
- `README.md` — fork's Credits section + L1+ tool tables; upstream additions go above the Credits block.

If a feature in upstream conflicts with the fork's index-backed equivalent (e.g. upstream adds a non-index GUID lookup that the fork already handles via `resolve_guid`), prefer the index-backed path and drop the upstream version. Note the divergence in the commit message so a future merger has context.

## Versioning

The fork uses semver scoped to its own surface. Upstream version numbers are not tracked — the fork's `package.json` version is independent. v1.0.0 marks the L9 release-gate (full L1-L8 surface shipped + audited).
