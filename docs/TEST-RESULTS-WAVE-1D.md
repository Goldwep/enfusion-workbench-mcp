# Wave 1D results — L6 scripts + L8 read-only + prompts

## Summary
- Total: 17, Passed: 13, Failed: 0, Skipped: 4

## Cases
| TC ID | Tool | Result | Notes |
|---|---|---|---|
| 1D-01 | script_analyze | PASS | EMCP_WB_Terrain.c — 3 classes, 4 methods, 11 fields detected. Classes: EMCP_WB_TerrainRequest, EMCP_WB_TerrainResponse, EMCP_WB_Terrain. |
| 1D-02 | script_overrides | PASS | project_root=Test1. Scanned 20 .c files, 0 modded chains — empty-state UX confirmed. |
| 1D-03 | script_lint | PASS | EMCP_WB_Terrain.c — 0 errors, 1 warning (indent_mixed L2), 9 infos (if_paren_spacing). All 5 rules ran. |
| 1D-04 | script_format | PASS | DRY-RUN default honored. No trailing whitespace, no blank-line collapse, trailing-newline adjusted. No file written. |
| 1D-05 | script_class_hierarchy | PASS | root_class=JsonApiStruct, project_root=Test1 → "not in project — likely engine class". Engine-class fallback handled cleanly. |
| 1D-06 | script_extract_interface | PASS | EMCP_WB_Terrain.c — emitted markdown with all 3 classes' public methods + fields. No private/protected leakage. |
| 1D-07 | script_find_rpc_handlers | PASS | project_root=Test1, default attribute=RPC → 0 handlers across 20 files. Empty-state UX confirmed. |
| 1D-08 | gm_spawn_list_export | PASS | project_path=Test1 → "No SCR_PlaceableEntitiesRegistry configs found". Empty-state UX confirmed. |
| 1D-09 | faction_list_units | PASS | project_path=Test1 → 0 entity files scanned, no faction-bound entities. Empty-state UX confirmed. |
| 1D-10 | animation_find_unused_clips | PASS | project_path=Test1 → 0 .anm clips on disk, 0 referenced, 0 unused. Empty-state UX confirmed. |
| 1D-11 | weapon_pose_lint | PASS | Negative test: no .agr files exist on disk under addons/. Ran against C:/nonexistent/path/test.agr → structured "AGR file not found" error. |
| 1D-12 | server_mod_list | PASS | Negative test: no server.json on disk under addons/. Ran against C:/nonexistent/server.json → structured "server.json not found" error. |
| 1D-13 | server_scenario_picker (curated) | PASS | include_workshop=false → 13 official BI scenarios listed in markdown table. User project section shows 0 (no SCR_MissionHeader configs in Test1). |
| 1D-14 | server_scenario_picker (workshop) | PASS | include_workshop=true → same 13 BI scenarios + Workshop (0) section with "workshop path may be unset" message. |
| 1D-15 | server_health_probe | PASS | host=127.0.0.1, port=17777, timeout=2000ms → A2S query timed out after 2000ms. Expected (no server running). Structured error returned. |
| 1D-16 | mission_setup prompt | SKIP | Prompt registered in src/prompts/mission-setup.ts and wired in server.ts (line 118). MCP prompt invocation not exposed as a tool in this harness — only tools/* entries are surfaced via ToolSearch. Manual MCP prompts/list / prompts/get verification needed via direct MCP client. |
| 1D-17 | character_anim_pipeline_guide prompt | SKIP | Prompt registered in src/prompts/character-anim-pipeline-guide.ts and wired in server.ts (line 119). Same harness limitation as 1D-16. |
| 1D-18 | create-mod prompt | SKIP | Upstream prompt registered in src/prompts/create-mod.ts and wired in server.ts (line 15). Same harness limitation as 1D-16. |
| 1D-19 | modify-mod prompt | SKIP | Upstream prompt registered in src/prompts/modify-mod.ts and wired in server.ts (line 16). Same harness limitation as 1D-16. |

## Notes
- **No .agr files on disk** under `addons/`. Glob `**/*.agr` returned 0 matches. weapon_pose_lint exercised via negative test only.
- **No server.json on disk** under `addons/`. Glob `**/server*.json` returned 0 matches. server_mod_list exercised via negative test only.
- **Prompts not invokable in this harness.** All 4 prompts are correctly registered in the MCP server source, but Claude Code's tool surface only exposes `mcp__<server>__<tool>`-style tools. MCP prompts (which use a separate `prompts/list` + `prompts/get` JSON-RPC capability) are not invocable here. The prompts skip is a harness limitation, not a server bug.
- **Empty-result UX is uniform across L6+L8 read-only.** Every tool that returned 0 hits produced a clean, human-readable explanation rather than an error. Validates the empty-state design.
- **server_health_probe timeout was the slowest call (~2s).** Everything else was sub-second.
