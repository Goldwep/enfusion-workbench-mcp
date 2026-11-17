# wb_resources

```text
Resource database and import. path: project-relative source file.
Read:
search: Paged database search
selection: Browser selection
resolve: Name, GUID, meta of a path
addons: Loaded addons
newGuid: New GUID
wait: Wait for a file
Mutating:
register: Register a file
rebuild: Rebuild and wait
import: Register, set, rebuild
create: New file from a class
prefabFromModel: .et from an .xob
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Handler contract | `contracts/EMCP_WB_Resources.json` (EMCP_WB_Resources) |
| Census KB page | [data/kb/census/tools/wb_resources.md](../../../data/kb/census/tools/wb_resources.md) |

## Actions (11)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `search` | no | no | Paged database search | `rootPath` (string), `extensions` (array<string>), `searchStr` (array<string>), `tags` (array<string>), `recursive` (bool), `cursor` (string), `limit` (int) |
| `selection` | no | no | Browser selection | `recursive` (bool) |
| `resolve` | no | no | Name, GUID, meta of a path | `path`* (string) |
| `addons` | no | no | Loaded addons | `available` (bool) |
| `newGuid` | no | no | New GUID | none |
| `wait` | no | no | Wait for a file | `path`* (string), `timeoutMs` (int) |
| `register` | yes | yes | Register a file | `path`* (string), `buildRuntime` (bool), `confirm` (bool) |
| `rebuild` | yes | yes | Rebuild and wait | `path` (string), `paths` (array<string>), `configuration` (string), `timeoutMs` (int), `confirm` (bool) |
| `import` | yes | yes | Register, set, rebuild | `path`* (string), `settings` (array<string>), `allPlatforms` (bool), `configuration` (string), `confirm` (bool) |
| `create` | yes | yes | New file from a class | `path`* (string), `className`* (string), `inherit` (string), `confirm` (bool) |
| `prefabFromModel` | yes | yes | .et from an .xob | `xobPath`* (string), `path`* (string), `inherit` (string), `confirm` (bool) |

`*` marks a required parameter of that action.

## Input parameters (23)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | getInfo: BI GetResourceInfo; open: the owning editor; link: build or parse an enfusion:// link; browse: 1.x name of search One of: `search`, `selection`, `resolve`, `addons`, `newGuid`, `wait`, `register`, `rebuild`, `import`, `create`, `prefabFromModel`, `getInfo`, `open`, `link`, `browse`. |
| `rootPath` | string | no | $Addon:Folder/ or relative (every addon) |
| `extensions` | array<string> | no | without the dot |
| `searchStr` | array<string> | no | all words must match |
| `tags` | array<string> | no |  |
| `recursive` | boolean | no | default true |
| `cursor` | string | no | nextCursor of the previous page |
| `limit` | integer | no | default 50, max 200 |
| `path` | string | no | path, {GUID}, {GUID}path or source path |
| `available` | boolean | no | also list unloaded addons |
| `timeoutMs` | integer | no | default 1000, max 10000 |
| `buildRuntime` | boolean | no | build the runtime resource |
| `confirm` | boolean | no | true writes; else a dry run |
| `paths` | array<string> | no | batch; max 200 |
| `configuration` | string | no | default PC |
| `settings` | array<string> | no | name=value; enum by name or number |
| `allPlatforms` | boolean | no | write every configuration |
| `className` | string | no | root class, e.g. MatPBRBasic |
| `inherit` | string | no | ancestor ResourceName, loose or packed |
| `xobPath` | string | no | the model ResourceName |
| `expandResource` | boolean | no | getInfo: also read the container |
| `addon` | string | no | link: addon id (with path) |
| `url` | string | no | link: an enfusion:// link to parse |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_resources.<action>`. A row that links several actions is counted under each (38 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `addons` | 3 | T3 1, T5 2 | `api:Workbench.GetCurrentGameProjectFile/0`, `mcp:action/wb_resources.addons`, `mcp:handler-action/EMCP_WB_Resources.addons` |
| `browse` | 2 | T2 1, T3 1 | `mcp:action/wb_resources.browse`, `mcp:handler-action/EMCP_WB_Resources.search` |
| `create` | 2 | T5 2 | `mcp:action/wb_resources.create`, `mcp:handler-action/EMCP_WB_Resources.create` |
| `getInfo` | 2 | T2 1, T5 1 | `mcp:action/wb_resources.getInfo`, `net:handler/GetResourceInfo` |
| `import` | 2 | T5 2 | `mcp:action/wb_resources.import`, `mcp:handler-action/EMCP_WB_Resources.import` |
| `newGuid` | 3 | T3 1, T5 2 | `api:Workbench.GenerateGloballyUniqueID64/0`, `mcp:action/wb_resources.newGuid`, `mcp:handler-action/EMCP_WB_Resources.newGuid` |
| `open` | 2 | T0 1, T3 1 | `mcp:action/wb_resources.open`, `mcp:handler-action/EMCP_WB_Resources.open` |
| `prefabFromModel` | 2 | T5 2 | `mcp:action/wb_resources.prefabFromModel`, `mcp:handler-action/EMCP_WB_Resources.prefabFromModel` |
| `rebuild` | 4 | T5 4 | `api:ResourceManager.RebuildResourceFile/3`, `api:ResourceManager.RebuildResourceFiles/2`, `mcp:action/wb_resources.rebuild` |
| `register` | 3 | T5 3 | `api:ResourceManager.RegisterResourceFile/2`, `mcp:action/wb_resources.register`, `mcp:handler-action/EMCP_WB_Resources.register` |
| `resolve` | 5 | T3 3, T5 2 | `api:MetaFile.GetResourceID/0`, `api:Workbench.GetAbsolutePath/3`, `api:Workbench.GetResourceName/1` |
| `search` | 2 | T2 1, T3 1 | `mcp:action/wb_resources.search`, `mcp:handler-action/EMCP_WB_Resources.search` |
| `selection` | 3 | T2 1, T3 2 | `api:ResourceManager.GetResourceBrowserSelection/2`, `mcp:action/wb_resources.selection`, `mcp:handler-action/EMCP_WB_Resources.selection` |
| `wait` | 3 | T5 3 | `api:ResourceManager.WaitForFile/2`, `mcp:action/wb_resources.wait`, `mcp:handler-action/EMCP_WB_Resources.wait` |
