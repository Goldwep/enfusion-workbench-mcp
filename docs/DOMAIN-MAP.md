# DOMAIN-MAP — Total Feature Surface (2026-05-21 audit)

**Purpose.** Inventory every tool we *could* build for the MCP, with verified feasibility per domain. Produced by a 7-agent read-only squad against the Arma Reforger Tools install (`C:\Program Files (x86)\Steam\steamapps\common\Arma Reforger Tools`), the user's `Test1` project, the pre-downloaded BIKI cache, and the existing MCP repo.

**Outcome.** ~110 proposed tools. After feasibility filter: **~75 ship-able** (GREEN), **~22 need investigation** (YELLOW), **~13 deferred or dropped** (RED). Combined with the 53 already shipped → **~125-130 total tools** at full build-out. Estimate ~10-14 weeks total at ~5-7 tools/week, accounting for the Enforce Script mini-parser, the custom EMCP-handler architecture for live tools, and one round of bug-fix tax (cross-cutting fixes below).

**Verdict legend.** G = ready to build now. Y = needs one verification step (format probe, RPC reverse-eng, or sample acquisition). R = blocked on engine support, native dep, or BI internals.

**Priority.** P0 = must-have (P0s collectively define "MCP that materially uplifts a mod author"). P1 = high-value, ship soon. P2 = nice-to-have.

---

## 0. Cross-cutting facts uncovered

These are repo-wide context that every cluster ended up needing. Capturing once.

### Engine surfaces actually addressable

1. **Static file analysis** — `.gproj`, `.et`, `.conf`, `.ent`, `.layout`, `.emat`, `.ptc`, `.styles`, `.st` all use Enfusion text container format. One parser (`src/formats/enfusion-text.ts`) covers all of them. The project-index currently scans only the first five extensions; adding the rest unlocks ~10 tools as thin SQL queries.
2. **Live Workbench RPC via TCP** — the existing `WorkbenchClient` + JsonApi pattern (handler scripts `EMCP_WB_*.c` shipped via `wb_launch`) is the canonical bridge. Every "live" tool needs (a) a Workbench-side `.c` handler with `LoadFromString` / `SaveToString` and (b) a Node-side MCP tool that calls `client.call(...)`. This is a **two-sided architecture** — plan time accordingly.
3. **PAK VFS read** — `core/data.pak` is partially decompressable via a custom zlib central-dir walker (already partly built at `src/pak/`). Exposes engine-generated script headers (`scripts/Core/generated/WorkbenchAPI/...`) that document class shapes missing from public Doxygen. A handful of entries hit `inflateRawSync: invalid block type` — capture as a known gotcha; non-blocking.
4. **CLI invocation** — `ArmaReforgerWorkbenchSteamDiag.exe` has ~80 documented flags (Startup_Parameters BIKI page). `-validate`, `-buildData`, `-publishAddon*`, `-wbModule=X -plugin=Y -run` are the high-leverage ones. `-help` is silent so flags are discovered via BIKI + `strings`, not via the binary itself.
5. **Doxygen API zips** — `Workbench/docs/{Arma,Enfusion}ScriptAPIPublic.zip` extracted to local cache → ~8700 classes searchable. Sufficient for class lookups; insufficient for examples (only one rendered example file exists).

### Hard ceilings (don't propose tools around these)

- **`.anm` / `.xanim` compiled animation binaries** — opaque, undocumented. Pursue animation tooling via `.agr/.agf/.ast/.asi/.aw` source-side files + FBX upstream, not compiled side.
- **PAK extraction back to source** — explicitly impossible (BIKI: "Packaged files cannot be extracted back to source files"). Drop `wb_extract_pak`.
- **Workshop mod removal** — irreversible and CLI-unsupported. Drop `workshop_remove`; document in `workshop_info` instead.
- **Server mission rotation** — engine doesn't support it (BIKI explicit). Drop `server_mission_rotation_setup`.
- **First-time Workshop publish** — requires GUI for license/categories/contributors. CLI does updates only. Reflect in tool description.
- **BI wiki via WebFetch** — returns 403. Use pre-downloaded `wiki_search`/`wiki_read` exclusively.

### Cross-cutting bug-fixes surfaced (need scheduling regardless of new tools)

1. **`server_config` emits DEPRECATED field names** — `gameHostBindAddress/BindPort/RegisterBindAddress/RegisterPort` were renamed to `bindAddress/bindPort/publicAddress/publicPort` in v0.9.8.73. Tool produces wire-incompatible JSON. File: `src/templates/server-config.ts:29-54`. Hard P0 fix.
2. **L2-5.1 — Enfusion text serializer bare-vs-quoted bug** — already known; `ID TestMod` should emit as `ID "TestMod"`. Currently blocks every write-mode refactor. P0.
3. **L2-5.2 — SubScene files flagged as scan errors** — already known; SubScene has no own GUID, just `Parent "{GUID}path"`. Should be classified "unindexable, not error". P1.
4. **`animation_graph` tool is vehicle-shaped only** — `generateAgrAuthor`, `generateAstAuthor`, `generateAgfInstructions` all take a `VehicleConfig`. Character authoring path is missing. P1 — add character preset.
5. **Some PAK entries hit `inflateRawSync` error** — `WorldEditorAPI.c`, `RoadGeneratorEntity.c`, `GenericTerrainEntity.c` (the entity .c specifically). Doesn't block other entries; needs a non-stdlib decompression path or hand-rolled deflate. P2.
6. **PowerShell-in-Bash deny rule + tar Windows path quirks**

### Highest-leverage prerequisites

| Prereq | Cost | Unlocks |
|---|---|---|
| **Enforce Script mini-parser** (`src/script-parser/`) | 2-3 days | All of Script (~10 tools) + half of Refactor (~6 tools) |
| **Extend `SCANNABLE_EXTENSIONS`** with `.emat`, `.ptc`, `.styles`, `.st` | <1 day | ~10 inspect/find-unused/lint tools as thin queries |
| **Surgical byte-edit helper** for resource files (find span, splice, write `.bak`) | 1 day | All refactor tools (~11 tools) |
| **EMCP handler template + plugin discovery** | 1-2 days | All live Workbench tools (~25 tools across terrain/anim/audio/material) |
| **Fix L2-5.1 serializer** | <1 day | Unblocks safer (non-surgical) refactor paths |
| **Schema v2 (project_id FK)** | <1 day | Already planned; gates per-project queries used by ~15 tools |

Sequencing these six gates first compresses the whole roadmap. The plan must build them before the tools that depend on them.

---

## 1. Cluster: Script analysis & lint  (10 tools)

All depend on the Enforce Script mini-parser unless noted.

| Tool | Purpose | Verdict | Pri |
|---|---|---|---|
| `script_analyze` | Parse `.c` → AST (classes, modded chains, methods, RPCs, RplProps, attrs) | G | P0 |
| `script_lint` | Configurable static analysis. Port BI's `SCR_BasicCodeFormatterPlugin` rules + add modding-specific (deprecated API, missing super, RPC misuse, ref/out param) | G | P0 |
| `script_overrides` | Given base class name → every `modded class X` project-wide | G | P0 |
| `script_format` | Apply BI formatter rules headlessly (trim trailing, 4→tab, `if(` spacing, etc.) — direct port of documented plugin | G | P1 |
| `script_class_hierarchy` | Render full inheritance + modded chain for a class. Joins engine API hierarchy (existing Doxygen index) with user `modded` chains | G | P1 |
| `script_find_rpc_handlers` | Locate `[RPC(...)]`-decorated methods project-wide | Y | P1 |
| `script_find_event_subscribers` | Locate `ScriptInvoker.Insert(...)` call sites | Y | P1 |
| `script_callers` | Find every callsite of a method project-wide. False-positive risk without type inference — return "likely callers" with confidence marker | Y | P1 |
| `script_extract_interface` | Emit public surface of a class as markdown (for handoff/docs) | G | P2 |
| `script_diff` | Semantic diff by class/method (not by line). AST fingerprint set-diff | G | P2 |

**Drop:** `script_validate` — defer to Workbench's built-in live validation when connected. `script_lint` is the offline equivalent and adds more value. Also drop `script_dependency_graph` — completeness depends on cross-file symbol resolution that exceeds parser scope.

**Pattern.** BI ships its own lint plugin **as Enforce script source** (`SCR_BasicCodeFormatterPlugin.c`). Every rule is documented on the BIKI Basic_Code_Formatter_Plugin page → `script_lint` is a port-by-spec, not original research. Same for `script_format`. The mini-parser is the gate; treat it as infrastructure, not as a tool.

---

## 2. Cluster: Refactoring  (11 tools)

**Safety doctrine.** Every write-mode refactor MUST: (a) use surgical byte-edits, never parse+serialize, until L2-5.1 lands AND a fidelity-preserving serializer exists; (b) write `.bak` sidecar; (c) re-run `scanRefs` post-edit to verify DB; (d) refuse if file has uncommitted git changes unless `force=true`.

| Tool | Purpose | Verdict | Pri |
|---|---|---|---|
| `refactor_replace_guid` | Swap one GUID for another across project. Word-boundary regex on word-bounded 16-hex. Highest-leverage primitive | G | P0 |
| `refactor_move_resource_path` | Rename/move a `.et`/`.conf`/`.ent` file, update all braced `{GUID}path` refs. GUID stays, path-suffix bytes change | G | P0 |
| `refactor_rename_project_id` | Rename `ID "<name>"` on a `.gproj` — single-line surgical edit | G | P1 |
| `refactor_normalize_dependencies` | Sort `.gproj` Dependencies block, dedupe, validate each GUID exists | G | P1 |
| `refactor_merge_duplicate_guids` | Diagnose two files claiming same GUID; "fix" mode composes `refactor_replace_guid` + new GUID | G | P1 |
| `refactor_remove_unused` | Delete resources with zero inbound refs. Dry-run by default. **High data-loss risk** if confirm skipped | G | P1 |
| `refactor_dedupe_resources` | Find structurally-identical resources (content-hash of canonicalized AST), propose merge. Read-only analysis | G | P2 |
| `refactor_extract_inherited_to_concrete` | Flatten a prefab's inheritance into the child. Reuses existing `prefab-ancestry.ts walkChain`. Output to `<file>.flattened.et` first | Y | P2 |
| `refactor_rename_class` | Rename class symbol across `.c` files. **Requires Enforce script index** (not in current scan set). | R until script-parser exists | P2 |
| `refactor_rename_method` / `..._variable` / `refactor_extract_method` / `refactor_inline_method` / `refactor_move_class_to_file` | Same as above — script-side family, all blocked on script-parser + script-index | R | P2 |

**Drop:** none outright. Lower the script-side family to P2 deferred until script-parser + script-symbol-index land.

**Pattern.** GUID semantics are uniform across `.gproj` (bare in deps), `.et`/`.conf`/`.ent` (braced asset paths). A GUID-replace primitive is the single highest-leverage safe operation, and most other useful refactors (`move_resource_path`, `merge_duplicate_guids`, `rename_project_id`) compose from it plus narrowly-scoped surgical edits.

---

## 3. Cluster: Scenario, mission, faction  (13 tools)

**Context.** Existing `scenario_create_conflict` is far more sophisticated than `scenario_create` (live) — emits 5-7 layer files (CAH, defenders, ambient vehicles). Gap: nothing **inspects, validates, or diffs** existing scenarios; nothing helps with Scenario Framework SP/co-op beyond placing one objective; nothing helps with factions beyond minimal stub.

| Tool | Purpose | Verdict | Pri |
|---|---|---|---|
| `scenario_inspect` | Read `.conf` (+ follow World→`.ent`→layers); emit game mode class, factions, base/spawn count, objective count, layer breakdown | G | P0 |
| `scenario_validate` | Rule set: orphan GUIDs, base-whitelist mismatch, missing FactionManager, factionless spawns, MOB missing source-radio | G | P0 |
| `faction_create` | Scaffold `Configs/Factions/<Key>.conf` with full `SCR_Faction` field set (key, name, color, flag, group catalog, loadout catalog) | G | P0 |
| `scenario_diff` | Structural diff between two scenario revisions — added/removed entities, changed components, moved transforms. Match by name not by GUID | G | P1 |
| `scenario_clone_area` | Select entities within bounding box, duplicate at new position with fresh GUIDs | G | P1 |
| `faction_validate` | Lint a `SCR_Faction` config for missing flag, missing loadout catalog, invalid color, key uniqueness | G | P1 |
| `faction_list_units` | Given faction key, list every unit/group/vehicle catalog'd to it (walks catalog inheritance) | Y | P1 |
| `mission_setup` | Scaffold new scenario from template (game mode + factions + spawns). Extend to non-Conflict modes (Scenario Framework SP, Game Master) | Y | P1 |
| `scenario_balance_report` | Entities per faction + asset summary. Markdown table for asymmetric balance review | G | P2 |
| `scenario_export_graph` | Mermaid graph: bases ↔ radio coverage, objectives ↔ pre-reqs, CAH zones inside major bases | Y | P2 |
| `gm_spawn_list_export` | Enumerate spawnables for Game Master in a given scenario (driven by `SCR_EditorPlaceables` configs) | G | P2 |
| `scenario_apply_template` | Stamp a curated template (FOB pack, checkpoint, patrol grid) at a position. Built on `scenario_clone_area` | G | P2 |
| `gamemaster_export_zen` | Capture live GM session to a `.layer`. **Requires new EMCP handler `EMCP_WB_DumpGMEntities`** | R until handler exists | P2 |

**Pattern.** Parser already round-trips, project-index already records inheritance refs — `scenario_validate` gets ~80% of its rules for free via `find_broken_refs` (planned in L2-4). User has world stub `Testerz.ent` but `Test1/Missions/` is empty — `mission_setup` is the natural next step for their current workflow state.

---

## 4. Cluster: Terrain, world, navmesh  (16 tools)  ← user-emphasized

**Context.** Existing `wb_terrain` only does `getHeight(x,z)` + `getBounds()`. `wb_layers` is layer-file management, NOT splatting masks. The gap is wide. Engine APIs documented but require live Workbench + custom EMCP handlers.

| Tool | Purpose | Verdict | Pri |
|---|---|---|---|
| `world_compose_summary` | Parse `.ent` directly (text); entity counts by class, layer breakdown, sub-scene parents | G | P0 |
| `world_validate_refs` | Find broken `{GUID}path` refs in a world/layer. Pure offline tool, no Workbench needed | G | P0 |
| `terrain_inspect` | Aggregate `wb_terrain getBounds` + `GenericTerrainEntity.GetTileNumber/GetTileTextureResName` + road count + river count + biome via custom `EMCP_WB_TerrainInspect.c` handler | G | P0 |
| `terrain_navmesh_status` | Report navmesh tile coverage (`NavmeshWorldComponent.IsTileLoaded/Valid/Requested` over a grid) + bake recency | G | P0 |
| `terrain_navmesh_bake` | Trigger rebake via `Workbench.OpenModule(NavmeshGeneratorMain)` → `ExecuteAction(menuPath)` → `Save()`. **Async + poll pattern** for long-running bake | Y | P0 |
| `terrain_export_heightmap` | Dump heightmap to .png/.r16. Try `ExportTerrainRequest` JsonApi first; fallback to `TryGetHeightTC` grid sample + Node image encoder | Y | P0 |
| `terrain_road_export_graph` | `RoadNetworkManager.GetRoadsInAABB` → per-road `GetPoints + GetWidth` → JSON graph with intersections via spatial-hash | G | P1 |
| `terrain_road_validate` | Find disconnected segments, dead-end stubs, untagged intersections. Pure graph traversal on `road_export_graph` output | G | P1 |
| `terrain_river_export` | Enumerate `RiverEntity` instances → `GetCentralPolyline(out positions, out widths, precision)`. Useful for mission design (river crossings) | G | P1 |
| `terrain_water_surface_query` | `ChimeraWorldUtils.TryGetWaterSurface(world, point, out surfacePoint, out type, out transform)` bulk grid | G | P1 |
| `terrain_save_world_as` | Wrap `GameWorldEditor.SaveWorldAs(savePath, overridePath)` for branching workflow (Beta → main) | G | P1 |
| `terrain_layer_stats` | Per-tile texture name histogram. Full blend-percentage requires `.edds` decode via `Compressonator_MD_DLL.dll` (Phase 2) | Y | P1 |
| `terrain_brush_apply` | Programmatic raise/lower/smooth/paint at position via `TerrainToolDesc_*` + `WorldEditorAPI`. Per-apply = TCP round-trip; bulk slow | Y | P1 |
| `world_diff` | Semantic diff between two `.ent` files (entities added/removed/moved). Floating-point epsilon tolerance for transforms | G | P1 |
| `world_biome_summary` | Identify biome/season/sky config. Enfusion has no first-class "biome" object — synthesize from weather + season + foliage layer set | Y | P2 |
| `terrain_import_heightmap` | Replace heightmap from external image. Brush-per-pixel infeasible; engine bulk-replace API unverified | R likely | P2 |
| `terrain_foliage_density_report` | Per-species foliage count. Foliage is texture-mask driven; `.edds` decode needed AND no public enumeration API | R likely | P2 |

**Pattern.** Engine class hierarchies for terrain are extractable from `addons/core/data.pak` (generated script headers under `scripts/Core/generated/WorkbenchAPI/Terrain/`) — richer than the public Doxygen surface. The MCP already has the right plumbing (PAK VFS + JsonApi NET handlers + handler-script copy in `wb_launch`). Each P0/P1 tool here is roughly 1 handler script + 1 MCP tool.

---

## 5. Cluster: Animation & character  (9 tools — most are extensions)

**Context.** Existing `animation_graph` tool handles `.agr/.agf/.ast/.asi/.aw` parsing well, but its summary/validator/guide generators are all vehicle-shaped (`VehicleConfig`). Character authoring path is the gap.

| Tool | Purpose | Verdict | Pri |
|---|---|---|---|
| `character_inspect` | Summarize a character/mannequin prefab — `CharacterAnimationComponent` config, linked AGR, attachments, stance/weapon components. Confirmed: `SCR_ChimeraCharacter`, `CharacterAnimationComponent` | G | P0 |
| `animation_inspect` (extend) | Add character-flavoured summary mode to existing tool. Surface weapon-pose tags, stance vars, movement vars | G | P0 |
| `animation_validate` (extend) | Add V06-V10 rules: weapon-pose tag references, IK targets without IkChain, animation-event names with no AGF listener | G | P1 |
| `animation_diff` | Semantic graph diff. "GUID-blind" mode (compare by name/type) | G | P1 |
| `weapon_pose_lint` | Validate weapon-pose tag set (ADS/RAISED/LOWERED/PRIMARY/SECONDARY) against AGR globalTags. Pure string-level — no binary parsing | G | P1 |
| `animation_find_unused_clips` | AST × ASI cross-ref vs AGF nodes that play sources. Naive substring match with low-confidence flag | G | P1 |
| `character_anim_pipeline_guide` | Workflow generator for "FBX → in-game animated character". Extends existing `generateGuide("character")` scaffold with armature naming ("Armature", "Root") + NLA bake + FBX export + AST/ASI authoring + prefab setup | G | P1 |
| `animation_bone_chain_export` | Union of bone names across IkChain.Joints + ProcTransform.bone + BoneMask. **Bone names only, not hierarchy** — true hierarchy needs FBX SDK | Y | P2 |
| `animation_proc_anim_inspect` | Summarize `ProcAnimComponent`/`VehicleProcAnimComponent`/`CarProcAnimComponent` config in a prefab. Minor extension to prefab/component reader | G | P2 |

**Drop:**
- `animation_list_clips_by_skeleton` — requires `.anm`/`.xanim` binary parsing or FBX SDK. R.
- `animation_keyframe_extract` — same blocker. R.
- `fbx_inspect` — heavy native dep (Blender headless or FBX SDK binding). Y, deferred to P2.

**Pattern.** Weapon-pose system is **string-tag based** in AGR `GlobalTags { "WEAPON" "ADS" ... }` block coupled with script-side `IsWeaponADSTag/IsWeaponRaisedTag/...` queries. `weapon_pose_lint` is purely string-level. Compiled anim extensions (`.anm`/`.xanim`) produce no hits anywhere in install/Blender plugin/API zips — author-facing tooling rides on `.agr/.agf/.ast/.asi/.aw` source + FBX upstream, not compiled side.

---

## 6. Cluster: Materials, particles, audio, UI  (16 tools)

**Fast first move.** Add `.emat`, `.ptc`, `.styles`, `.st` to `project-index/resource-scan.ts:SCANNABLE_EXTENSIONS` + extend `ref-scan.ts` to capture `Texture*` / sound refs. That single change unlocks 60% of the proposed tools as thin SQL queries.

### Materials  (4)

| Tool | Purpose | Verdict | Pri |
|---|---|---|---|
| `material_inspect` | Parse `.emat` → shader class, texture refs (resolved via `resolve_guid`), tunable params | G | P0 |
| `material_find_unused_textures` | Inventory `.edds` textures; report which have zero inbound refs from any `.emat` | G | P1 |
| `material_validate` | Wrap `MaterialValidator` script class via new EMCP handler. Confirmed: `MaterialValidatorRequest/Response` are JsonApiStruct. Falls back to file lint when Workbench disconnected | Y | P1 |
| `material_diff` | Per-param diff between two `.emat`. Flag shader-class changes as full replacement | G | P2 |

### Particles  (3)

| Tool | Purpose | Verdict | Pri |
|---|---|---|---|
| `particle_inspect` | Parse `.ptc` → emitters, curves/gradients, per-emitter texture refs. Format presumed Enfusion text but `[unverified]` — needs sample probe | Y | P1 |
| `particle_validate` | Static lint — missing texture refs, dangling GUIDs, emitter count thresholds | Y | P2 |
| `particle_list_textures` | Cross-cutting texture-ref enumeration. Reuses ref-scan once `.ptc` in scannable set | Y | P2 |

### Audio  (3, all deferred — most opaque domain)

Audio assets are binary banks; sound events referenced by `resourceName + eventName` strings. `AudioEditor` script class has no public enumeration methods. Defer until concrete sample addon surfaces.

| Tool | Purpose | Verdict | Pri |
|---|---|---|---|
| `audio_list_by_category` | Walk project for sound resource refs, group by addon-path prefix or naming convention | Y | P2 |
| `audio_find_unused` | Same pattern as `material_find_unused_textures` for audio resources | Y | P2 |
| `audio_inspect_sound_event` | List events on a sound resource. Blocked — no script API enumeration | R | P2 |

**Recommendation.** Replace inspection with `audio_play_event` (runtime trigger via EMCP) for higher LLM-agent value. Flag for L4.

### UI  (5)

| Tool | Purpose | Verdict | Pri |
|---|---|---|---|
| `ui_layout_inspect` | Parse `.layout` → widget hierarchy (names, anchors, offsets, style refs). Reverse of existing `layout_create` types | G | P0 |
| `ui_localization_audit` | For each language in `.gproj` `StringTables`, list missing keys in per-language runtime `.conf` | G | P0 |
| `ui_layout_validate` | Lint: missing widgets referenced by `FindAnyWidget("...")` in `.c`, duplicate widget names, malformed anchors | G | P1 |
| `ui_extract_strings` | Find hardcoded strings in `.layout` Text properties + `.c` Set* calls that should be `#AR-key` localization tokens | G | P1 |
| `ui_styles_inspect` | Parse `.styles` file → all defined widget style entries with properties | G | P1 |
| `ui_styles_diff` | Compare two `.styles` files. Sample data: `default.styles` vs `debugUI.styles` already in core | G | P2 |

### Cross-cutting asset tools  (2)

| Tool | Purpose | Verdict | Pri |
|---|---|---|---|
| `asset_orphan_scan` | Generalize "find unused" to any asset type. One tool replaces material/particle/audio variants | G | P1 |
| `asset_list_by_size` | Group all assets by extension + size threshold. Optimization triage | G | P2 |

**Pattern.** `MaterialResourceInfo`/`TextureResourceInfo` are `JsonApiStruct` subclasses with `LoadFromFile`/`SaveToFile` — canonical bridge for runtime asset inspection. Worth a future sweep enumerating all `JsonApiStruct` subclasses to harvest runtime-backed tools cheaply.

---

## 7. Cluster: Workshop, server, logs, internals  (24 tools)

### Workshop  (6 — 1 dropped)

| Tool | Purpose | Verdict | Pri |
|---|---|---|---|
| `workshop_validate_manifest` | Pre-flight a mod against Workshop constraints (name/summary/description/notes length; preview/screenshot size 2MB; version cap; `.edds` with missing source) | G | P0 |
| `workshop_pack` | Bundle to disk without uploading. `-wbModule=ResourceManager -packAddon -packAddonDir <out>`. Output dir + warning summary | G | P1 |
| `workshop_publish` | CLI publish for **updates only** (initial publish needs GUI). `-publishAddon* -publishAddonChangeNoteFile`. Surface as updates-only in tool description. **NEVER auto-call `-wbBackendLogin`** | G | P1 |
| `workshop_check_deps` | Walk `.gproj` Dependencies; resolve each GUID against installed `addons/<NAME>_<GUID>/`; flag missing | G | P1 |
| `workshop_list_local_projects` | List `.gproj` files in user's workspace addon dir. **Rename from `workshop_list_my_mods`** — no local list of owned-on-Workshop exists | Y | P2 |
| `workshop_diff_versions` | Compare two bundled mod directories file-by-file (size, hash) | G | P2 |

**Drop:** `workshop_remove` — irreversible + CLI-unsupported. Document in `workshop_info` tool description instead.

### Server  (7)

**Security front.** `server.json` carries `passwordAdmin`, `rcon.password`, `admins[]` (SteamIDs), `persistence.databases.*.options.headers.X-API-KEY`. Build a `redactServerConfig(json)` helper and route every read through it. Never echo secrets back even if user passed them in. RCON tools restricted to read-only allow list (`#players`, `#roles`, `#id`).

| Tool | Purpose | Verdict | Pri |
|---|---|---|---|
| `server_create_config` (replace existing) | Emit schema-correct JSON with full field surface — current schema (`bindAddress`/`publicAddress`/`rcon`/`passwordAdmin`/`admins`/`crossPlatform`/`operating`/`persistence` blocks). **Fixes wire-incompat bug.** | G | P0 |
| `server_validate_config` | Read `server.json`, schema check, port/range validation, semantic warnings (`fastValidation:false` on public, `battlEye:false`, weak RCON pwd, `visible:true` without `passwordAdmin`). Redacts secrets in output | G | P0 |
| `server_mod_list` | Resolve/inspect/manage `mods[]` array. Cross-ref each modId GUID against locally downloaded `<name>_<GUID>` addon dirs | G | P1 |
| `server_scenario_picker` | Surface BIKI's 31 official scenarios + scan addon dirs for `Missions/*.conf` (mod-provided) | G | P1 |
| `server_launch` | Spawn `ArmaReforgerServer.exe -config <path> [...]`. **Probe for exe first** (separate Steam app 1874900, NOT in Tools install). Structured "install steam app 1874900" error if missing | Y | P1 |
| `server_health_probe` | UDP A2S query to confirm server up + return playercount/map. Optional RCON ping (read-only allow-list) | G | P1 |
| `server_admin_commands_doc` | Static knowledge tool — `#login`/`#kick`/`#ban`/`#players`/etc. with permission matrix. Pure prose | G | P2 |

**Drop:** `server_mission_rotation_setup` — engine doesn't support rotation.

### Logs  (6)

Log format confirmed: `<profile>/logs/logs_YYYY-MM-DD_HH-MM-SS/{console,error,script}.log` with `HH:MM:SS.ms  CATEGORY  [(W|E)] : message` line shape. Categories: ENGINE, RESOURCES, SCRIPT, INIT, PROFILING, BACKEND, DEFAULT. Same format for server logs.

| Tool | Purpose | Verdict | Pri |
|---|---|---|---|
| `logs_list` | Enumerate `logs_*/` dirs sorted newest-first; sizes + last-modified | G | P0 |
| `logs_tail` | Last N lines from console/script/error.log of latest (or specified) session | G | P0 |
| `logs_filter` | Tail with regex/level/category filters + pagination | G | P0 |
| `logs_summarize_errors` | Group (W)/(E) by category + leading message; counts + first-seen + samples | G | P0 |
| `logs_extract_crash` | Locate crash bundle (`crashreport_*.zip`, `*.mdmp`, `wbSettingsDump.ini`) next to logs_* dir + error.log tail. Directory convention unverified | Y | P1 |
| `logs_backend_inspect` | Read `<logs_session>/.backend/` HTTP traffic to Bohemia backend. Structure unverified | Y | P2 |
| `logs_grep_for_obsolete` | Wrapper around `logs_filter` for `'X' is obsolete` warnings — quick "deprecated API I touched" view | G | P2 |

### Workbench internals  (5 — 1 dropped)

| Tool | Purpose | Verdict | Pri |
|---|---|---|---|
| `wb_validate_scripts` | `-wbModule=ScriptEditor -validate [config]`. Supports PC/HEADLESS/XBOX_SERIES etc. **`HEADLESS` is a real validated config** — free "server-side compile" check | G | P0 |
| `wb_cli_run` | Generic CLI runner with **curated, validated** flag surface. Enum input `command` → strictly-shaped arg list (prevents injection). Parses last log for errors | G | P1 |
| `wb_build_data` | Wrap `-buildData PC <out>` with type/path/tag filters. Used for CI/automation | G | P1 |
| `wb_plugin_run` | Invoke specific plugin by class name via `-wbModule=<X> -plugin=<ClassName>` | Y | P1 |
| `wb_plugin_list` | Grep `.c` files for `WorkbenchPluginAttribute(` → enumerate plugin classes per editor module | G | P2 |
| `wb_navmesh_generate` | `-wbModule=NavmeshGeneratorMain -run -autogenerate <world>` (alternate path to `terrain_navmesh_bake`) | G | P2 |
| `wb_force_save_all` | `-wbModule=WorldEditor -run -load <ent> -forceSaveAll`. Bulk-fix workflow | G | P2 |
| `wb_settings_dump` / `wb_clear_settings` | Export/import Workbench user settings (`.ini` via `-forceSettings`) + one-shot reset (`-clearSettings`) | G | P2 |

**Drop:** `wb_extract_pak` — encrypted format, BI explicit "Packaged files cannot be extracted back to source files".

---

## 8. Tool count + dependency summary

### Net new (after de-duplication + drops)

| Cluster | Proposed | Drop/Defer | Ship-able | of which P0 |
|---|---:|---:|---:|---:|
| Script | 10 | 1 | 9 | 3 |
| Refactor | 11 | 0* | 11 | 2 |
| Scenario/Mission/Faction | 13 | 0 | 13 | 3 |
| Terrain/World/Navmesh | 16 | 2 | 14 | 6 |
| Animation/Character | 9 | 3 | 6 | 2 |
| Materials/Particles/Audio/UI | 16 | 1 | 15 | 3 |
| Workshop/Server/Logs/Internals | 24 | 3 | 21 | 6 |
| **Net new ship-able** | **99** | **10** | **89** | **25** |

\*Script-side refactors are demoted to P2 (blocked on script-parser) but not dropped.

Add existing 53 → **~142 tools at full build-out**. After realistic feasibility (Y → some discovered to be R, some YAGNI): plan to ship ~115-125.

### Dependency graph (build order)

```
schema-v2 (project_id FK) ─┐
                           ├──► find_broken_refs, find_unused_resources, list_resources,
                           │    list_dependencies, inheritance_chain  (L2-4, already planned)
SCANNABLE_EXTENSIONS+ ─────┤
                           ├──► material_inspect, ui_layout_inspect, ui_localization_audit,
                           │    particle_inspect, ui_styles_inspect, asset_orphan_scan
serializer-fix L2-5.1 ─────┤
surgical-byte-edit lib ────┼──► refactor_replace_guid, refactor_move_resource_path,
                           │    refactor_rename_project_id, refactor_normalize_dependencies
                           │
Enforce-Script parser ─────┼──► script_analyze, script_lint, script_overrides, script_format,
                           │    script_class_hierarchy, script_callers, script_extract_interface,
                           │    script_diff, script_find_rpc_handlers, script_find_event_subscribers
                           │
                           └──► refactor_rename_class/method/variable/extract/inline/move_class
                                (script-side refactors)
                                
EMCP handler template ─────┐
plugin discovery ──────────┼──► terrain_inspect, terrain_navmesh_status, terrain_navmesh_bake,
                           │    terrain_export_heightmap, terrain_road_export_graph,
                           │    terrain_river_export, terrain_water_surface_query,
                           │    terrain_save_world_as, terrain_brush_apply, terrain_layer_stats,
                           │    material_validate, character_inspect (live mode)
                           │
                           └──► long-running task pattern (async + poll for bake/buildData/publish)

Independent pure-FS tools (no prereqs):
  ├──► logs_list, logs_tail, logs_filter, logs_summarize_errors, logs_extract_crash
  ├──► workshop_validate_manifest, workshop_check_deps, workshop_pack, workshop_diff_versions
  ├──► wb_validate_scripts, wb_cli_run, wb_build_data, wb_plugin_list
  ├──► world_compose_summary, world_validate_refs, world_diff
  ├──► scenario_inspect, scenario_validate, scenario_diff, scenario_clone_area, scenario_balance_report
  ├──► faction_create, faction_validate, faction_list_units
  ├──► server_create_config (FIX existing), server_validate_config, server_mod_list,
  │    server_scenario_picker, server_health_probe, server_admin_commands_doc
  └──► weapon_pose_lint, animation_diff, animation_find_unused_clips, character_anim_pipeline_guide
```

The pure-FS tools account for ~35 tools and can ship immediately after the SCANNABLE_EXTENSIONS extension. Heavy prereqs (mini-parser, EMCP handler template) gate the remaining ~50.

---

## 9. Open verification gates (sample of must-probe items)

These are the YELLOWs that need one verification step each before promotion to GREEN. Each is small — minutes-hours, not days.

1. **`.ptc` format** — confirm Enfusion text by extracting one from `data.pak` and running it through the parser. Falls in/out of GREEN based on result.
2. **`ExportTerrain*` RPC payload shape** — try `client.call("ExportTerrain", {...})` against live Workbench, capture response. Determines whether `terrain_export_heightmap` is heightmap-bulk or grid-sample.
3. **`NavmeshGeneratorMain` menu path** for `ExecuteAction(["Tools","Bake"])` — needs one-time recording via `wb_execute_action`. Determines `terrain_navmesh_bake` UX.
4. **`[RPC(...)]` attribute parameter shape** — find one real example in BI samples (likely `SCR_BaseGroupCommand` or any core `*Component.c`). Determines `script_find_rpc_handlers` accuracy.
5. **`.acp` and audio bank discovery** — find any sound config in a mod tree to validate the audio sub-cluster. Without a sample we defer the whole sub-cluster.
6. **`logs_*/crashreport_*.zip` directory convention** — trigger a crash (or grep an existing one) to verify location. Determines `logs_extract_crash` viability.

---

## 10. Recommended ordering rationale

Bias toward **independent pure-FS tools first** (no Workbench, no parser, no handler) — they ship fast, validate the tool-creation pipeline, and accrete value quickly. Then build prereqs (mini-parser + EMCP template) once, then unlock the dependent waves.

Tier-0 (parallel-shippable after schema v2):
- All logs tools, workshop_validate_manifest, workshop_check_deps, server_validate_config, server_create_config FIX, wb_validate_scripts, world_compose_summary, world_validate_refs.

Tier-1 (after SCANNABLE_EXTENSIONS+):
- material_inspect, ui_layout_inspect, ui_localization_audit, asset_orphan_scan, particle_inspect.

Tier-2 (after surgical-byte-edit lib):
- All resource refactors.

Tier-3 (after mini-parser):
- All script analysis + lint + format.

Tier-4 (after EMCP handler template):
- All terrain live tools, character_inspect (live), material_validate (live), audio runtime tools.

Tier-5 (after Tier-3 and 4):
- Script-side refactors, advanced animation tooling, scenario_export_graph, world_biome_summary.

The ultraplan (forthcoming) sequences these tiers into weekly milestones.

---

## Appendix: Tool counts by verdict

- **GREEN ship-able now or after a known prereq**: ~75
- **YELLOW needs single verification probe**: ~22
- **RED dropped or deferred to engine support**: ~13
- **Existing shipped**: 53
- **Total surface at full build-out**: ~125-130 tools.
