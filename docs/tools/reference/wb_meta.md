# wb_meta

```text
A resource .meta: import settings per platform. path: the project-relative source file.
Read:
get: GUID, class and ancestor per platform, tags
vars: Per-variable schema of one configuration
Mutating:
set: Set an import setting
clear: Reset an import setting
setAncestor: Set the base config
assignMaterial: Model material slot to .emat
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Handler contract | `contracts/EMCP_WB_Meta.json` (EMCP_WB_Meta) |
| Census KB page | [data/kb/census/tools/wb_meta.md](../../../data/kb/census/tools/wb_meta.md) |

## Actions (6)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `get` | no | no | GUID, class and ancestor per platform, tags | `path`* (string) |
| `vars` | no | no | Per-variable schema of one configuration | `path`* (string), `platform` (string), `fields` (string), `cursor` (string), `limit` (int) |
| `set` | yes | yes | Set an import setting | `path`* (string), `name`* (string), `value`* (string), `platform` (string), `allPlatforms` (bool), `confirm` (bool) |
| `clear` | yes | yes | Reset an import setting | `path`* (string), `name`* (string), `platform` (string), `allPlatforms` (bool), `confirm` (bool) |
| `setAncestor` | yes | yes | Set the base config | `path`* (string), `value`* (string), `platform` (string), `confirm` (bool) |
| `assignMaterial` | yes | yes | Model material slot to .emat | `path`* (string), `name`* (string), `value`* (string), `confirm` (bool) |

`*` marks a required parameter of that action.

## Input parameters (10)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `get`, `vars`, `set`, `clear`, `setAncestor`, `assignMaterial`. |
| `path` | string | no | source file or {GUID}path |
| `platform` | string | no | default PC |
| `fields` | string | no | columns kept, comma-separated |
| `cursor` | string | no | nextCursor of the previous page |
| `limit` | integer | no | default 50, max 200 |
| `name` | string | no | variable name |
| `value` | string | no | new value as text |
| `allPlatforms` | boolean | no | write every configuration |
| `confirm` | boolean | no | true writes; else a dry run |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_meta.<action>`. A row that links several actions is counted under each (15 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `assignMaterial` | 2 | T2 1, T3 1 | `mcp:action/wb_meta.assignMaterial`, `mcp:handler-action/EMCP_WB_Meta.assignMaterial` |
| `clear` | 2 | T5 2 | `mcp:action/wb_meta.clear`, `mcp:handler-action/EMCP_WB_Meta.clear` |
| `get` | 4 | T3 1, T5 3 | `api:MetaFile.GetSourceFilePath/0`, `api:ResourceManager.GetMetaFile/1`, `mcp:action/wb_meta.get` |
| `set` | 3 | T3 1, T5 2 | `api:MetaFile.Save/0`, `mcp:action/wb_meta.set`, `mcp:handler-action/EMCP_WB_Meta.set` |
| `setAncestor` | 2 | T5 2 | `mcp:action/wb_meta.setAncestor`, `mcp:handler-action/EMCP_WB_Meta.setAncestor` |
| `vars` | 2 | T5 2 | `mcp:action/wb_meta.vars`, `mcp:handler-action/EMCP_WB_Meta.vars` |
