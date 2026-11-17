# wb_prefabs

```text
Prefabs and prefab edit mode.
Read:
getAncestor: Prefab an entity inherits from
editState: Edit mode on, root, prefab
Mutating:
createTemplate: Entity to a new .et; confirm
save: Save the edited prefab; confirm
addMembers: Add a prefab under a member
removeMembers: Remove members
moveToPrefab: Move entities into a prefab
clone: Copy to a new .et; confirm
createChild: New child .et; confirm
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Handler contract | `contracts/EMCP_WB_Prefabs.json` (EMCP_WB_Prefabs) |
| Census KB page | [data/kb/census/tools/wb_prefabs.md](../../../data/kb/census/tools/wb_prefabs.md) |

## Actions (9)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `getAncestor` | no | no | Prefab an entity inherits from | `entity`* (string) |
| `createTemplate` | yes | yes | Entity to a new .et; confirm | `entity`* (string), `path`* (string), `confirm` (bool) |
| `save` | yes | yes | Save the edited prefab; confirm | `entity` (string), `confirm` (bool) |
| `editState` | no | no | Edit mode on, root, prefab | none |
| `addMembers` | yes | yes | Add a prefab under a member | `member`* (string), `prefab`* (string) |
| `removeMembers` | yes | yes | Remove members | `entities`* (array<string>) |
| `moveToPrefab` | yes | yes | Move entities into a prefab | `parent`* (string), `entities`* (array<string>), `convertTransform` (bool) |
| `clone` | yes | yes | Copy to a new .et; confirm | `prefab`* (string), `path`* (string), `confirm` (bool) |
| `createChild` | yes | yes | New child .et; confirm | `prefab`* (string), `path`* (string), `confirm` (bool) |

`*` marks a required parameter of that action.

## Input parameters (13)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `getAncestor`, `createTemplate`, `save`, `editState`, `addMembers`, `removeMembers`, `moveToPrefab`, `clone`, `createChild`, `getGuid`, `locate`. |
| `entity` | string | no | id:<hex> \| name:<n> \| index:<i> |
| `path` | string | no | new project-relative .et |
| `confirm` | boolean | no | true writes; else a dry run |
| `member` | string | no | instance; its prefab gets it |
| `prefab` | string | no | {GUID}path.et |
| `entities` | array<string> | no | prefab member children |
| `parent` | string | no | instance in the world |
| `convertTransform` | boolean | no | default true |
| `entityName` | string | no | 1.x: entity name (use entity) |
| `templatePath` | string | no | 1.x: new .et path (use path); getGuid: prefab file path |
| `addonName` | string | no | 1.x: refused; the open project is the target |
| `searchPath` | string | no | locate: absolute folder path in an addon |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_prefabs.<action>`. A row that links several actions is counted under each (35 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `addMembers` | 4 | T5 4 | `api:WorldEditorAPI.AddPrefabMembers/2`, `mcp:action/wb_prefabs.addMembers`, `mcp:handler-action/EMCP_WB_Prefabs.addMembers` |
| `clone` | 2 | T5 2 | `mcp:action/wb_prefabs.clone`, `mcp:handler-action/EMCP_WB_Prefabs.clone` |
| `createChild` | 2 | T5 2 | `mcp:action/wb_prefabs.createChild`, `mcp:handler-action/EMCP_WB_Prefabs.createChild` |
| `createTemplate` | 3 | T5 3 | `api:WorldEditorAPI.CreateEntityTemplate/2`, `mcp:action/wb_prefabs.createTemplate`, `mcp:handler-action/EMCP_WB_Prefabs.createTemplate` |
| `editState` | 4 | T5 4 | `api:SCR_WorldEditorToolHelper.GetPrefabEditModeEntitySource/0`, `api:WorldEditor.IsPrefabEditMode/0`, `mcp:action/wb_prefabs.editState` |
| `getAncestor` | 2 | T5 2 | `mcp:action/wb_prefabs.getAncestor`, `mcp:handler-action/EMCP_WB_Prefabs.getAncestor` |
| `getGuid` | 2 | T2 1, T3 1 | `mcp:action/wb_prefabs.getGuid`, `net:handler/GetPrefabGUID` |
| `locate` | 3 | T2 2, T3 1 | `mcp:action/wb_prefabs.locate`, `net:handler/LocatePrefabsFromPath`, `net:handler/LocateProject` |
| `moveToPrefab` | 3 | T4 3 | `api:WorldEditorAPI.MoveEntitiesToPrefab/4`, `mcp:action/wb_prefabs.moveToPrefab`, `mcp:handler-action/EMCP_WB_Prefabs.moveToPrefab` |
| `removeMembers` | 4 | T3 4 | `api:WorldEditorAPI.RemovePrefabMembers/1`, `mcp:action/wb_prefabs.removeMembers`, `mcp:handler-action/EMCP_WB_Prefabs.removeMembers` |
| `save` | 6 | T5 6 | `api:WorldEditorAPI.SaveEntityTemplate/1`, `mcp:action/wb_prefabs.save`, `mcp:handler-action/EMCP_WB_Prefabs.save` |
