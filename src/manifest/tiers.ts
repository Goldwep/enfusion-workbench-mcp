/**
 * Tool tiers and the registration filter (phase3-tool-surface.md section 7).
 * ENFUSION_TOOLSET=core|extended|all (default core) plus ENFUSION_TOOLS=+name,-name.
 * src/server.ts applies it to every registerTool through gateToolRegistration (below).
 */

export type Tier = "core" | "extended" | "alias";
export type Toolset = "core" | "extended" | "all";

/** The 18 1.x tools the token memo names, plus the Phase 3 nouns, the wave W1 nouns (DEC-061) and wb_meta (W2, DEC-063). */
export const CORE_TOOLS = [
  "wb_connect",
  "wb_state",
  "wb_diagnose",
  "wb_launch",
  "wb_census",
  "api_search",
  "wiki_search",
  "wiki_read",
  "project",
  "game_browse",
  "game_read",
  "asset_search",
  "logs_tail",
  "prefab",
  "script_create",
  "mod",
  "resolve_guid",
  "find_references",
  "wb_module",
  "wb_container",
  "wb_scripts",
  "wb_plugin",
  "wb_entity",
  "wb_view",
  "wb_world",
  "wb_meta",
] as const;

/**
 * 1.x names that map to a Phase 3 or W1 action (see aliases.ts); listed only under `all`. The first
 * four route through routeAlias into wb_module / wb_scripts (wb_save is the design section 6 dry run
 * unless confirm: true); the six 1.x entity tools into wb_entity, wb_view and wb_container (OD-1);
 * particle_inspect into particle inspect and terrain_navmesh_status into wb_navmesh status (W5 OD-1).
 */
export const ALIAS_TOOLS = [
  "wb_open_resource",
  "wb_save",
  "wb_validate_scripts",
  "wb_reload",
  "wb_entity_create",
  "wb_entity_delete",
  "wb_entity_inspect",
  "wb_entity_list",
  "wb_entity_modify",
  "wb_entity_select",
  // Wave W5 OD-1 (DEC-068): the 1.x readers route to particle inspect and wb_navmesh status.
  "particle_inspect",
  "terrain_navmesh_status",
  // Wave W8 OD-1 (DEC-076): the 1.x menu runner routes to wb_menu run.
  "wb_execute_action",
] as const;

/**
 * Every other tool, named so the table never drifts silently: a tool registered under
 * ENFUSION_TOOLSET=all that is in none of the three lists fails tests/server-registration.test.ts.
 * wb_bi and wb_gui are extended by design (section 2). Waves W4, W5 and W6 add thirteen extended
 * tools (DEC-067, DEC-068, DEC-069); W7 adds wb_terrain_edit and wb_generator (DEC-075), W8 adds
 * wb_settings, wb_link, wb_diag and wb_menu (DEC-076).
 */
export const EXTENDED_TOOLS = [
  "animation_find_unused_clips",
  "animation_graph",
  "animation_set",
  "animation_workspace",
  "asset_orphan_scan",
  "audio",
  "behavior_tree",
  "building_setup",
  "component_search",
  "config_create",
  "config_edit",
  "faction_create",
  "faction_list_units",
  "find_broken_refs",
  "find_unused_resources",
  "game_duplicate",
  "gm_spawn_list_export",
  "imageset",
  "inheritance_chain",
  "layout_create",
  "layout_edit",
  "list_dependencies",
  "list_resources",
  "logs_filter",
  "logs_list",
  "logs_summarize_errors",
  "material_diff",
  "material_find_unused_textures",
  "material_inspect",
  "meta_file",
  "navmesh",
  "particle",
  "procanim",
  "project_index_status",
  "project_settings",
  "project_validate",
  "refactor_merge_duplicate_guids",
  "refactor_move_resource_path",
  "refactor_normalize_dependencies",
  "refactor_remove_unused",
  "refactor_rename_project_id",
  "refactor_replace_guid",
  "scenario_apply_template",
  "scenario_clone_area",
  "scenario_create",
  "scenario_create_conflict",
  "scenario_diff",
  "scenario_inspect",
  "script_analyze",
  "script_class_hierarchy",
  "script_extract_interface",
  "script_find_rpc_handlers",
  "script_format",
  "script_lint",
  "script_lsp",
  "script_overrides",
  "server_config",
  "server_health_probe",
  "server_launch",
  "server_mod_list",
  "server_scenario_picker",
  "server_stop",
  "server_validate_config",
  "string_table",
  "terrain_inspect",
  "terrain_road_export_graph",
  "ui_extract_strings",
  "ui_layout_inspect",
  "ui_layout_validate",
  "ui_localization_audit",
  "ui_styles_inspect",
  "wb_anim",
  "wb_anim_debug",
  "wb_audio",
  "wb_bi",
  "wb_build_data",
  "wb_cleanup",
  "wb_cli_run",
  "wb_clipboard",
  "wb_component",
  "wb_diag",
  "wb_entity_duplicate",
  "wb_generator",
  "wb_gui",
  "wb_knowledge",
  "wb_layers",
  "wb_link",
  "wb_localization",
  "wb_menu",
  "wb_navmesh",
  "wb_particle",
  "wb_play",
  "wb_prefabs",
  "wb_projects",
  "wb_resources",
  "wb_script_editor",
  "wb_settings",
  "wb_shape",
  "wb_stop",
  "wb_terrain",
  "wb_terrain_edit",
  "wb_undo_redo",
  "wb_validate",
  "wb_world_tools",
  "weapon_pose_lint",
  "workshop_check_deps",
  "workshop_info",
  "workshop_validate_manifest",
  "world_compose_summary",
  "world_diff",
  "world_validate_refs",
] as const;

export const TIERS: Readonly<Record<string, Tier>> = Object.freeze({
  ...Object.fromEntries(CORE_TOOLS.map((n) => [n, "core" as const])),
  ...Object.fromEntries(ALIAS_TOOLS.map((n) => [n, "alias" as const])),
  ...Object.fromEntries(EXTENDED_TOOLS.map((n) => [n, "extended" as const])),
});

/** A tool absent from the table is extended. */
export function tierOf(name: string): Tier {
  return TIERS[name] ?? "extended";
}

export function parseToolset(raw: string | undefined): Toolset {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "" || v === "core") return "core";
  if (v === "extended" || v === "all") return v;
  throw new Error(`ENFUSION_TOOLSET must be core, extended or all, got '${raw}'`);
}

export interface ToolOverrides {
  add: Set<string>;
  remove: Set<string>;
}

/** `+name,-name` (a bare name counts as `+`). */
export function parseToolOverrides(raw: string | undefined): ToolOverrides {
  const add = new Set<string>();
  const remove = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const t = part.trim();
    if (!t) continue;
    if (t.startsWith("-")) remove.add(t.slice(1).trim());
    else add.add(t.startsWith("+") ? t.slice(1).trim() : t);
  }
  return { add, remove };
}

function inToolset(tier: Tier, set: Toolset): boolean {
  if (set === "all") return true;
  if (set === "extended") return tier !== "alias";
  return tier === "core";
}

/** True when `name` should be registered under the given env. `-name` wins over `+name`. */
export function shouldRegister(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const set = parseToolset(env.ENFUSION_TOOLSET);
  const o = parseToolOverrides(env.ENFUSION_TOOLS);
  if (o.remove.has(name)) return false;
  if (o.add.has(name)) return true;
  return inToolset(tierOf(name), set);
}

export function filterTools<T extends { name: string }>(
  tools: T[],
  env: NodeJS.ProcessEnv = process.env,
): T[] {
  return tools.filter((t) => shouldRegister(t.name, env));
}

export interface GateStats {
  toolset: Toolset;
  registered: string[];
  skipped: string[];
}

/**
 * Wraps a server so registerTool consults shouldRegister(name, env): a refused tool is recorded
 * and not registered. Every other member (registerPrompt, registerResource, connect, ...) passes
 * through bound to the real server. Tool files are untouched; they call registerTool with a
 * literal name and ignore its return value.
 */
export function gateToolRegistration<S extends object>(
  server: S,
  env: NodeJS.ProcessEnv = process.env,
): { server: S; stats: GateStats } {
  const stats: GateStats = {
    toolset: parseToolset(env.ENFUSION_TOOLSET),
    registered: [],
    skipped: [],
  };
  const proxy = new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === "registerTool") {
        return (name: string, ...rest: unknown[]) => {
          if (!shouldRegister(name, env)) {
            stats.skipped.push(name);
            return undefined;
          }
          stats.registered.push(name);
          const real = Reflect.get(target, prop, target) as (...a: unknown[]) => unknown;
          return real.call(target, name, ...rest);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { server: proxy, stats };
}
