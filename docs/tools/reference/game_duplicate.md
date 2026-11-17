# game_duplicate

```text
Duplicate a base game prefab (.et) or config (.conf) into your mod folder for editing. Reads the file from game data or .pak archives, resolves the full ancestor chain, and injects inherited components so the duplicate is a complete representation of what the entity provides. Writes the file to your mod's directory, then registers it with Workbench so it gets a new resource GUID. Mirrors the Workbench right-click → Duplicate workflow. Set flatten=true to bake all ancestor components into a standalone prefab with no parent reference. Use asset_search to find the source path (with GUID) first.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/game_duplicate.md](../../../data/kb/census/tools/game_duplicate.md) |

## Input parameters (5)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `sourcePath` | string | yes | Source prefab path — either a GUID reference like '{657590C1EC9E27D3}Prefabs/Groups/OPFOR/Group_USSR_LightFireTeam.et' or a bare relative path like 'Prefabs/Groups/OPFOR/Group_USSR_LightFireTeam.et' |
| `destPath` | string | yes | Destination path within your mod folder, relative to the addon root (e.g., 'Prefabs/Groups/MyCustomGroup.et'). Must keep the source's extension (.et or .conf) |
| `modName` | string | no | Addon folder name under ENFUSION_PROJECT_PATH (e.g., 'MyMod'). If omitted, the first addon found in the project path is used. |
| `flatten` | boolean | no | When false (default), keeps the parent reference and includes ancestor components as overridable entries with original GUIDs preserved. When true, strips the parent reference and bakes all ancestor components into the copy, producing a fully standalone prefab. Default: `false`. |
| `register` | boolean | no | Register the duplicated file with Workbench after writing (assigns a new GUID). Requires Workbench to be running. Set false to write the file without registering. Default: `true`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/game_duplicate.<action>`. A row that links several actions is counted under each (2 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 2 | T2 1, T5 1 | `mcp:action/game_duplicate.run`, `mcp:handler-action/EMCP_WB_Resources.register` |
