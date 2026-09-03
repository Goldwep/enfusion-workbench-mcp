# L8 execution plan — scenario + animation + secondary live tools

**Prereqs:** L7 EMCP_WB_Terrain handler fully wired (not just `inspect`); EMCP_WB_Character handler exists; EMCP_WB_Job in place for any long-running L8 tool.

**Estimated:** 1-2 sessions. ~12 tools, most pure-FS (so non-blocking on L7 handler completion).

## L8 tool inventory (per DOMAIN-MAP §3 + §5)

### Scenario (pure-FS, can ship in parallel with L7-completion)

| Tool | Source | Output |
|---|---|---|
| `scenario_clone_area` | parse layer .conf, geometry filter, regen GUIDs, emit new layer | new .conf file path + entity count |
| `scenario_apply_template` | curated templates (FOB / checkpoint / patrol grid); stamp at position | new .ent additions |
| `gm_spawn_list_export` | walk `SCR_EditorPlaceables` configs, emit spawnable list per faction | markdown table |

### Faction (pure-FS)

| Tool | Source | Output |
|---|---|---|
| `faction_create` | scaffold `Configs/Factions/<Key>.conf` template | new .conf file |
| `faction_validate` | scoped variant of `project_validate scope=faction` | findings list |
| `faction_list_units` | walk catalogs, group by faction key | markdown table per faction |

### Animation (uses existing `src/animation/*` + L6 mini-parser for AST queries)

| Tool | Source | Output |
|---|---|---|
| `animation_inspect` (character mode) | extend existing `animation_graph` with character preset | structured summary |
| `animation_validate` V06-V10 | adds rules to existing validator | findings |
| `animation_find_unused_clips` | AST × ASI cross-ref vs AGF source nodes | unused-clip list |
| `weapon_pose_lint` | string-level check vs AGR `GlobalTags` | findings (no parser) |
| `character_anim_pipeline_guide` | prompt-mode, not tool — extends existing `generateGuide("character")` | markdown guide |

### Server (FS + process spawn)

| Tool | Source | Output |
|---|---|---|
| `server_launch` | probe for ArmaReforgerServer.exe (Steam app 1874900) | spawn outcome |
| `server_mod_list` | resolve mods[] from server.json | resolved/unresolved table |
| `server_health_probe` | UDP A2S query + optional RCON read-only allow-list | playercount, map, etc |
| `server_scenario_picker` | enumerate BIKI's 31 official + scan addon dirs for .conf | markdown table |

## Squad-delegation plan

**Wave 1 (parallel, 3 agents) — scenario + faction cluster (~6 tools):**
- Agent A: scenario_clone_area + scenario_apply_template
- Agent B: faction_create + faction_validate + faction_list_units
- Agent C: gm_spawn_list_export + animation_validate V06-V10

**Wave 2 (parallel, 2 agents) — animation + server cluster (~5 tools):**
- Agent A: animation_find_unused_clips + weapon_pose_lint
- Agent B: server_launch + server_mod_list + server_scenario_picker + server_health_probe

**Wave 3 (1 agent) — prompt registrations:**
- mission_setup + character_anim_pipeline_guide (both ship as prompts, not tools)

## L8→L9 audit gate

Standard 3-agent audit team (architecture / security / code-review) on the L8 surface. Focus areas:
- `server_launch` shell-spawn safety (process invocation of a separate Steam app)
- Server health-probe RCON allow-list enforcement
- Animation extensions don't regress existing `animation_graph` tests

## Critical-path notes

1. **Wave 1 can run in parallel with L7-completion.** All Wave-1 tools are pure-FS. No EMCP handler dependency.
2. **`server_launch` is the most security-sensitive L8 tool.** RCON-pwd handling must route through `RedactedServerConfig` from L3-2.
3. **`weapon_pose_lint` is pure string-level** — no Enforce parser needed; matches against AGR `GlobalTags { "WEAPON" "ADS" ... }` block.
