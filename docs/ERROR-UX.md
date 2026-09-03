# Error UX — canonical shape + per-tool audit (L9-5)

This document standardizes how every tool surfaces failure. The goal: an
LLM (or a human) consuming a tool's response should always see a
human-readable message AND an actionable next step — never a bare
`Error: undefined` or a raw `[object Object]` stack.

This is the **audit** product of L9-5. It enumerates the current state +
identifies inconsistencies. Mechanical standardization across all tools
is a follow-up; do NOT mass-rewrite messages from this document alone.

## 1 Canonical shape

Every tool that emits an error response (`isError: true`) **should**
follow this markdown shape in its single `content[0].text` payload:

```markdown
## Error

<one-line plain English of what failed>

### Hint

<actionable next step the caller can take — file path, flag to flip,
config var to set, neighboring tool to invoke>
```

Rationale:

- `## Error` heading lets LLMs latch onto a stable marker.
- The one-line message answers "what".
- `### Hint` answers "what to do" — the LLM (or the user) needs an exit
  ramp, not just a verdict.
- A single tool call returns one text block — multi-error tools may
  itemize under the heading but should keep the `### Hint` section last.

### Status quo

Most tools currently emit one of these informal shapes:

- `Error in <tool_name>: <msg>` (most common — see resolve_guid,
  find_references, terrain_*).
- `Error <verb> <noun>: <msg>` (e.g. `Error finding references: ...`,
  `Error resolving GUID: ...`).
- A free-form sentence with mid-paragraph hint
  (server_launch's "ArmaReforgerServer.exe not found ... Install Steam
  app 1874900").
- Bold-headered shape `**Connection Failed**` with embedded hint
  (wb_connect — the closest existing match to the canonical shape).

None currently emit a literal `## Error` heading. Migration to the
canonical shape is intentionally out of scope here — surfaced for L9-5
follow-up.

## 2 Per-tool audit table

Columns:

- **Tool** — MCP tool name (matches `server.registerTool` first arg).
- **Error states** — discrete failure modes the tool's `try/catch` and
  domain-validation paths return.
- **Current message shape** — what the user sees today.
- **Recommended hint** — the L9-5 target line.
- **isError set?** — whether the tool currently flips `isError: true` for
  this state (it should, for everything but soft "not found in index").

### 2.1 Project-index / GUID-lookup cluster

| Tool | Error state | Current message | Recommended hint | isError? |
|------|-------------|-----------------|------------------|----------|
| `resolve_guid` | malformed GUID | `Invalid GUID: must be 16 hex chars, optionally wrapped in braces. Got: <input>` | Pass 16 hex chars with or without braces, e.g. `A9806AF617972E97` or `{A9806AF617972E97}`. | yes |
| `resolve_guid` | GUID not in index | `No resource found for GUID {<guid>} in the project-index. The resource may live in a project not yet indexed, or may not exist in this Reforger install. Run \`project_index_status\` to see what's indexed.` | Run `project_index_status` to check coverage, or set `ENFUSION_PROJECT_PATH` to include the project that defines this GUID. | **no** (soft fail) |
| `resolve_guid` | uncaught throw | `Error resolving GUID: <msg>` | (depends on cause — should be wrapped in canonical shape with a per-cause hint). | yes |
| `find_references` | malformed GUID | `Invalid GUID "<raw>": expected 16 hex characters, with or without braces` (thrown via `normalizeGuid`, caught into `Error finding references: ...`) | Pass 16 hex chars with or without braces. | yes |
| `find_references` | invalid cursor (base64 / version / guid / kind mismatch) | `Error finding references: Invalid cursor: <reason>` | Discard the cursor — cursors are bound to a specific GUID + kind filter. Re-call without `cursor` to start fresh. | yes |
| `find_references` | zero matches | success-shaped (no `isError`), message says: `No references found for {<guid>}[ [kind=...]]. Either the resource is unused, or the project containing references isn't indexed yet.` | Try `project_index_status` to confirm coverage, or drop the `kind` filter to widen. | **no** (soft fail) |
| `find_references` | uncaught throw | `Error finding references: <msg>` | (depends on cause). | yes |
| `find_broken_refs` | uncaught throw | `Error finding broken refs: <msg>` | (depends on cause). | yes |
| `find_unused_resources` | uncaught throw | `Error finding unused resources: <msg>` | (depends on cause). | yes |
| `list_resources` | uncaught throw | `Error listing resources: <msg>` | (depends on cause). | yes |
| `list_dependencies` | uncaught throw | `Error listing dependencies: <msg>` | (depends on cause). | yes |
| `inheritance_chain` | uncaught throw | `Error resolving inheritance chain: <msg>` | (depends on cause). | yes |
| `project_index_status` | uncaught throw | `Error reading project-index status: <msg>` | (depends on cause). | yes |

### 2.2 Refactor cluster

| Tool | Error state | Current message | Recommended hint | isError? |
|------|-------------|-----------------|------------------|----------|
| `refactor_replace_guid` | malformed old/new GUID | thrown from `normalizeGuid`, caught into `Error in refactor_replace_guid: <msg>` | Pass 16 hex chars with or without braces. | yes |
| `refactor_replace_guid` | collision (new GUID already defines a resource) | dry-run plan-shape output marking `collision: true` with the collision file | Pick a different `new_guid` or call with `force: true` after manual review. | **no** (returns plan, not error) |
| `refactor_replace_guid` | no-op (old == new) | dry-run plan-shape output `(no-op — old and new GUID are identical)` | Pass distinct GUIDs. | **no** (soft) |
| `refactor_replace_guid` | uncommitted git changes | thrown from `atomicCommit`, caught into `Error in refactor_replace_guid: <msg>` | Commit local changes first, or pass `force: true` to bypass the git-clean check. | yes |
| `refactor_replace_guid` | mid-write failure | thrown from `atomicCommit` after rollback, caught into `Error in refactor_replace_guid: <msg>` | All `.bak` sidecars were restored — re-run after fixing the underlying I/O error. | yes |
| `refactor_move_resource_path` | target collision | similar plan-shape with collision | Pick a different target path. | mixed |
| `refactor_normalize_dependencies` | uncaught throw | `Error normalizing dependencies: <msg>` | (depends on cause). | yes |
| `refactor_merge_duplicate_guids` | uncaught throw | `Error merging duplicate GUIDs: <msg>` | (depends on cause). | yes |
| `refactor_remove_unused` | uncaught throw | `Error removing unused resources: <msg>` | (depends on cause). | yes |
| `refactor_rename_project_id` | uncaught throw | `Error renaming project id: <msg>` | (depends on cause). | yes |

### 2.3 Server-mgmt cluster (L8)

| Tool | Error state | Current message | Recommended hint | isError? |
|------|-------------|-----------------|------------------|----------|
| `server_launch` | flag-smuggling `server_config_path` | thrown from `rejectFlagLikePath`, caught into `Error in server_launch: <msg>` | Pass an absolute path that does NOT start with `-`. | yes |
| `server_launch` | server.json not found | thrown from `readRedactedServerConfig`, caught into `Error in server_launch: server.json not found at: <path>` | Run `server_config` to generate one first, or pass the correct absolute path. | yes |
| `server_launch` | malformed server.json | thrown from `readRedactedServerConfig`, caught into `Error in server_launch: Failed to parse server.json: <detail>` | Fix the JSON syntax (run `server_validate_config` for line-level diagnostics). | yes |
| `server_launch` | bad scenarioId | thrown from `prepareLaunchInputs`, caught into `Error in server_launch: <msg>` | Pass a full `{GUID}path` scenarioId. Use `server_scenario_picker` to see valid options. | yes |
| `server_launch` | invalid extra_args (non-flag, shell metachar) | thrown from `prepareLaunchInputs`, caught into `Error in server_launch: <msg>` | Each extra_arg must match `^-[a-zA-Z0-9_=:.,/\-]+$` — no spaces, no shell metacharacters. | yes |
| `server_launch` | ArmaReforgerServer.exe missing | `ArmaReforgerServer.exe not found at <path>. Install Steam app 1874900 (Arma Reforger Server) — separate download from the game / Tools.` | Install Steam app 1874900. | yes |
| `server_launch` | already running (PID file alive, no force) | full markdown response with PID, started_at, scenario_id; **no canonical Error heading** | Pass `force: true` or run `server_stop` first. | yes |
| `server_launch` | PID file write failure (best-effort) | not an error — surfaces as a warning bullet in the success response | (none — but `server_stop` will not work automatically). | no (warning) |
| `server_stop` | flag-smuggling `server_config_path` | thrown from `rejectFlagLikePath`, caught into `Error stopping server: <msg>` | Pass an absolute path that does NOT start with `-`. | yes |
| `server_stop` | PID file missing / dead PID | success-shaped `## server_stop — not_running` | (none — already stopped). | no |
| `server_stop` | timeout (SIGTERM + force-kill both fail) | `## server_stop — timeout` with WARNING summary | Re-run `server_stop`, or kill the PID manually. PID file is kept. | yes |
| `server_validate_config` | server.json not found | success-shaped: `server.json not found at: <path>\n\nUse \`server_config\` to generate one first.` | Run `server_config`. | **no** (soft fail) |
| `server_validate_config` | parse error | `Error parsing server.json as JSON: <msg>` | Fix the JSON syntax. | yes |
| `server_validate_config` | uncaught throw | `Error validating server config: <msg>` | (depends on cause). | yes |
| `server_config` | invalid input (zod) | thrown / caught into `Error generating server config: <msg>` | Re-check the `name`/`scenarioId`/etc. fields. | yes |
| `server_health_probe` | unreachable | `Server unreachable at <addr>:<port>` | Confirm the server is running and the a2s port is open. | yes |
| `server_mod_list` | uncaught throw | `Error listing server mods: <msg>` | (depends on cause). | yes |
| `server_scenario_picker` | uncaught throw | `Error picking scenario: <msg>` | (depends on cause). | yes |

### 2.4 Faction / scenario / template cluster

| Tool | Error state | Current message | Recommended hint | isError? |
|------|-------------|-----------------|------------------|----------|
| `faction_create` | flag-smuggling `faction_key` | `Invalid faction_key: must not start with '-' (got: <key>)` | Pass a faction key matching `^[A-Z][A-Z0-9_]{1,15}$`. | yes |
| `faction_create` | flag-smuggling `out_path` | `Invalid out_path: must not start with '-' (got: <path>)` | Pass a relative or absolute path that does not start with `-`. | yes |
| `faction_create` | invalid faction_key shape | thrown from `validateFactionKey`, caught into `Error creating faction: <msg>` | Use 2-16 uppercase letters / digits / underscores, starting with a letter. | yes |
| `faction_create` | missing `projectPath` config | `No projectPath configured. Set ENFUSION_PROJECT_PATH; out_path is resolved relative to and contained within projectPath.` | Set `ENFUSION_PROJECT_PATH` env var. | yes |
| `faction_create` | target already exists (no force) | `Error creating faction: file already exists at <path>; pass force=true to overwrite` | Pass `force: true` or pick a different `faction_key`. | yes |
| `faction_create` | uncommitted git changes (no force) | `Error creating faction: target has uncommitted changes; pass force=true to override` | Commit local changes, or pass `force: true`. | yes |
| `scenario_create` | bad filename | thrown from `validateFilename`, caught into `Error creating scenario: <msg>` | Use a safe filename — no path separators, no `..`. | yes |
| `scenario_create_conflict` | unknown world | thrown into caught message | Use one of the worlds listed by the tool description. | yes |
| `scenario_clone_area` | uncaught throw | `Error cloning scenario area: <msg>` | (depends on cause). | yes |
| `scenario_apply_template` | uncaught throw | `Error applying scenario template: <msg>` | (depends on cause). | yes |
| `scenario_diff` | one or both inputs missing | thrown / caught into `Error diffing scenarios: <msg>` | Pass two `.conf` paths that both exist. | yes |
| `scenario_inspect` | input missing | `Error inspecting scenario: <msg>` | Pass an existing `.conf` path. | yes |
| `config_create` | unknown configType | `Error creating config: <msg>` | Use one of: faction, gamemode, layer, slot, etc. | yes |
| `layout_create` | uncaught throw | `Error creating layout: <msg>` | (depends on cause). | yes |
| `script_create` | uncaught throw | `Error creating script: <msg>` | (depends on cause). | yes |

### 2.5 L7 EMCP-handler-backed tools (terrain_*, wb_*)

| Tool | Error state | Current message | Recommended hint | isError? |
|------|-------------|-----------------|------------------|----------|
| `terrain_inspect` | flag-smuggling world_path | `Invalid world_path: must not start with '-'` | Pass a path that does not start with `-`. | yes |
| `terrain_inspect` | EMCP handler not deployed | `EMCP_WB_Terrain handler not deployed in Workbench. Deploy mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Terrain.c (see docs/L7-PLAN.md) and reload the editor. Underlying error: <msg>` | Deploy `mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Terrain.c` and reload the editor (Ctrl+R). | yes |
| `terrain_inspect` | handler returned `status: "error"` | `EMCP handler returned error: <msg>` | (depends on cause — check Workbench console). | yes |
| `terrain_inspect` | uncaught throw | `Error in terrain_inspect: <msg>` | (depends on cause). | yes |
| `terrain_road_export_graph` | flag-smuggling world_path | `Invalid world_path: must not start with '-'` | Pass a path that does not start with `-`. | yes |
| `terrain_road_export_graph` | handler returns `not_implemented` | success-shaped: `Road graph export is not yet implemented in the Workbench handler. Tracking: docs/L7-PLAN.md (L7-1 EMCP_WB_Terrain road_export_graph). Will use RoadNetworkManager.GetRoadsInAABB once wired.` | Wait for L7-1 follow-up. | **no** (soft fail) |
| `terrain_road_export_graph` | handler returned non-ok | `Handler error: <msg>` | (depends on cause). | yes |
| `terrain_road_export_graph` | uncaught throw | `Error in terrain_road_export_graph: <msg>` | (depends on cause). | yes |
| `terrain_navmesh_status` | flag-smuggling world_path | `Invalid world_path: must not start with '-'` | Pass a path that does not start with `-`. | yes |
| `terrain_navmesh_status` | handler returns `not_implemented` | success-shaped: `Navmesh status query is not yet implemented in the Workbench-side handler. Tracking: docs/L7-PLAN.md (L7-1 EMCP_WB_Terrain navmesh_status). Underlying message: <msg>` | Wait for L7-1 follow-up. | **no** (soft fail) |
| `terrain_navmesh_status` | handler returned non-ok | `Handler error: <msg>` | (depends on cause). | yes |
| `terrain_navmesh_status` | uncaught throw | `Error in terrain_navmesh_status: <msg>` | (depends on cause). | yes |
| `wb_connect` | Workbench unreachable | `**Connection Failed**\n\nCould not reach Workbench. Ensure:\n1. Arma Reforger Tools (Workbench) is running\n2. NET API is enabled: File > Options > General > Net API\n3. The EnfusionMCP handler addon is loaded in Workbench` | Start Workbench, enable NET API, load the EnfusionMCP addon. | yes |
| `wb_connect` | uncaught throw | `**Connection Failed**\n\n<msg>\n\nEnsure Workbench is running with NET API enabled (File > Options > General > Net API).` | Same as above. | yes |
| `wb_entity_create` / `wb_entity_modify` / `wb_entity_delete` / `wb_entity_list` / `wb_entity_select` / `wb_entity_inspect` | handler unreachable / unknown | thrown / caught into `Error in wb_<verb>_entity: <msg>` | Run `wb_connect` to verify Workbench is reachable. | yes |
| `wb_clipboard` | uncaught throw | `Error in wb_clipboard: <msg>` | (depends on cause). | yes |
| `wb_component` | uncaught throw | `Error in wb_component: <msg>` | (depends on cause). | yes |
| `wb_play` / `wb_stop` / `wb_save` / `wb_undo_redo` / `wb_open_resource` (editor cluster) | uncaught throw | `Error in <tool>: <msg>` | (depends on cause). | yes |
| `wb_execute_action` | uncaught throw | `Error executing action: <msg>` | (depends on cause). | yes |
| `wb_layers` | uncaught throw | `Error in wb_layers: <msg>` | (depends on cause). | yes |
| `wb_localization` | uncaught throw | `Error in wb_localization: <msg>` | (depends on cause). | yes |
| `wb_prefabs` | uncaught throw | `Error in wb_prefabs: <msg>` | (depends on cause). | yes |
| `wb_projects` | uncaught throw | `Error in wb_projects: <msg>` | (depends on cause). | yes |
| `wb_reload` | uncaught throw | `Error in wb_reload: <msg>` | (depends on cause). | yes |
| `wb_resources` | uncaught throw | `Error in wb_resources: <msg>` | (depends on cause). | yes |
| `scenario_create` (live branch) | uncaught throw | `Error in scenario_create: <msg>` | (depends on cause). | yes |
| `wb_script_editor` | uncaught throw | `Error in wb_script_editor: <msg>` | (depends on cause). | yes |
| `wb_state` | uncaught throw | `Error in wb_state: <msg>` | (depends on cause). | yes |
| `wb_terrain` | uncaught throw | `Error in wb_terrain: <msg>` | (depends on cause). | yes |
| `wb_launch` | Workbench process exit / spawn failure | `Error launching Workbench: <msg>` | Check `workbenchPath` config + that the EXE is present. | yes |
| `wb_validate` | uncaught throw | `Error validating: <msg>` | (depends on cause). | yes |
| `wb_diagnose` | wb_ping fails | structured markdown: `**Status:** DISCONNECTED ...` | Run `wb_connect`; check Workbench is running + NET API enabled. | mixed |

### 2.6 Workshop / world / misc

| Tool | Error state | Current message | Recommended hint | isError? |
|------|-------------|-----------------|------------------|----------|
| `workshop_validate_manifest` | `.gproj` missing | `Error validating manifest: <msg>` | Pass an existing `.gproj` path. | yes |
| `workshop_validate_manifest` | dev-handler dir present | error finding in the report (severity=error) | Remove `Scripts/WorkbenchGame/EnfusionMCP/` before publish. | yes (per-finding) |
| `workshop_check_deps` | uncaught throw | `Error checking deps: <msg>` | (depends on cause). | yes |
| `workshop_info` | network failure | `Error fetching workshop info: <msg>` | Check internet connectivity / Workshop URL validity. | yes |
| `world_compose_summary` | uncaught throw | `Error composing world summary: <msg>` | (depends on cause). | yes |
| `world_diff` | one or both inputs missing | `Error diffing worlds: <msg>` | Pass two `.ent` paths that both exist. | yes |
| `world_validate_refs` | uncaught throw | `Error validating world refs: <msg>` | (depends on cause). | yes |

## 3 Standardizing "EMCP handler not deployed"

Each L7 wrapper currently rolls its own phrasing for the same situation
(a tool dispatches to a missing Enforce-side handler). Consolidating
into ONE message gives consumers a stable string to grep / match on.

### Current (audit)

| Tool | Current phrasing |
|------|------------------|
| `terrain_inspect` | `EMCP_WB_Terrain handler not deployed in Workbench. Deploy mod/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Terrain.c (see docs/L7-PLAN.md) and reload the editor. Underlying error: <msg>` |
| `terrain_road_export_graph` | (uses `status: "not_implemented"` branch, not "handler not deployed" — different concept) |
| `terrain_navmesh_status` | (uses `status: "not_implemented"` branch, not "handler not deployed" — different concept) |
| `wb_connect` | `**Connection Failed** ... 3. The EnfusionMCP handler addon is loaded in Workbench` (mentions handler addon, not by-handler-name) |

Other L7 wrappers (`wb_entity_*`, `wb_prefabs`, `wb_terrain`, `wb_layers`,
`wb_clipboard`, `wb_component`, `wb_play`/`wb_stop`/`wb_save`/`wb_undo_redo`/`wb_open_resource`, `wb_script_editor`,
`wb_state`, `wb_reload`, `wb_resources`, `wb_projects`, `scenario_create`,
`wb_localization`, `wb_execute_action`) do NOT currently special-case
the "handler missing" path — they let it propagate as a generic
`Error in <tool>: <msg>` containing whatever underlying error the
`WorkbenchClient.call` threw.

### Consistency findings

- **Agree on phrasing:** only `terrain_inspect` explicitly handles the
  "handler not deployed" string. Every other L7 tool relies on the
  generic catch.
- **Dissent:** `terrain_road_export_graph` and `terrain_navmesh_status`
  use `status: "not_implemented"` as a soft-success — semantically a
  different state (handler IS deployed but the action is unimplemented).
  Don't conflate.
- **Wb-cluster:** `wb_*` tools currently don't surface a structured
  "handler missing" — caller has to grep the underlying error text.

### Recommended canonical text

For the "handler binary not deployed" case (different from "action not
implemented"):

```
EMCP handler `<HANDLER_NAME>` is not deployed in Workbench.
Deploy `mod/Scripts/WorkbenchGame/EnfusionMCP/<HANDLER_NAME>.c` and reload the editor (Ctrl+R).
See `docs/L7-PLAN.md` for the handler architecture.
Underlying error: <msg>
```

For the "action not yet implemented" case (handler responded with
`status: "not_implemented"`):

```
EMCP handler `<HANDLER_NAME>` does not yet implement action `<ACTION>`.
Tracking: docs/L7-PLAN.md (<plan-section>).
Underlying message: <msg>
```

Implementation work for L9-5 follow-up:

1. Add a shared helper in `src/workbench/client.ts` (or a sibling) that
   detects the "unknown method" / "not registered" error shape coming
   out of `client.call` and re-throws a typed
   `HandlerNotDeployedError` carrying the handler name.
2. Update each L7 wrapper's `try/catch` to recognize that error type
   and emit the canonical text.
3. Keep the per-handler hint (which `.c` file to deploy) — that's the
   actionable bit.

## 4 Migration plan (L9-5 follow-up)

1. Introduce a small `src/utils/error-format.ts` helper exporting
   `formatToolError({ tool, message, hint })` that emits the canonical
   `## Error\n\n<msg>\n\n### Hint\n\n<hint>` shape.
2. Update each tool's `catch` arm to compose via the helper. Default
   `hint` to "Re-run with `ENFUSION_MCP_DEBUG=1` to see the full stack."
3. Add the `HandlerNotDeployedError` class + detection per §3.
4. Snapshot-test the canonical shape at the helper, not at each tool —
   one source of truth.
5. Per-tool work goes in clusters (refactor cluster, server cluster,
   wb cluster, terrain cluster) — small enough PRs to review one shape
   at a time.

Out of scope for L9-5 itself: rewriting every tool. This is the audit,
not the rewrite.
