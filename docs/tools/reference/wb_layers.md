# wb_layers

```text
Layers and folders of the open world.
Read:
list: Layers of a sub-scene by id
tree: Layer and folder tree, paged
Mutating:
create: Create a layer
createFolder: Create a layer folder
rename: Rename a layer or folder
delete: Delete a layer or folder; non-empty: withContents
move: Move under another folder
setActive: Set the layer new entities go to
lock: Lock a layer
unlock: Unlock a layer
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Handler contract | `contracts/EMCP_WB_Layers.json` (EMCP_WB_Layers) |
| Census KB page | [data/kb/census/tools/wb_layers.md](../../../data/kb/census/tools/wb_layers.md) |

## Actions (10)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `list` | no | no | Layers of a sub-scene by id | `subScene` (int) |
| `tree` | no | no | Layer and folder tree, paged | `subScene` (int), `cursor` (string), `limit` (int) |
| `create` | yes | yes | Create a layer | `name`* (string), `parentPath` (string), `subScene` (int) |
| `createFolder` | yes | yes | Create a layer folder | `name`* (string), `parentPath` (string), `subScene` (int) |
| `rename` | yes | yes | Rename a layer or folder | `layer`* (string), `name`* (string), `subScene` (int) |
| `delete` | yes | yes | Delete a layer or folder; non-empty: withContents | `layer`* (string), `subScene` (int), `confirm` (bool), `withContents` (bool) |
| `move` | yes | yes | Move under another folder | `layer`* (string), `parentPath`* (string), `subScene` (int) |
| `setActive` | yes | yes | Set the layer new entities go to | `layer`* (string), `subScene` (int) |
| `lock` | yes | yes | Lock a layer | `layer`* (string), `subScene` (int) |
| `unlock` | yes | yes | Unlock a layer | `layer`* (string), `subScene` (int) |

`*` marks a required parameter of that action.

## Input parameters (11)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | 1.x names still accepted: getActive, getEntityLayer, isVisible, getInfo, toggleLock One of: `list`, `tree`, `create`, `createFolder`, `rename`, `delete`, `move`, `setActive`, `lock`, `unlock`, `getActive`, `getEntityLayer`, `isVisible`, `getInfo`, `toggleLock`. |
| `subScene` | integer | no | default: current |
| `cursor` | string | no | nextCursor of the previous page |
| `limit` | integer | no | default 50, max 200 |
| `name` | string | no |  |
| `parentPath` | string | no | folder path |
| `layer` | string | no | layer or folder path |
| `confirm` | boolean | no | withContents: false = dry run |
| `withContents` | boolean | no | delete its entities and children too |
| `layerID` | integer | no | 1.x isVisible/getInfo/toggleLock: layer id from list |
| `entityName` | string | no | 1.x getEntityLayer (refused: use wb_entity get) |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_layers.<action>`. A row that links several actions is counted under each (54 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `create` | 4 | T5 4 | `api:WorldEditorAPI.CreateSubsceneLayer/3`, `mcp:action/wb_layers.create`, `mcp:handler-action/EMCP_WB_Layers.create` |
| `createFolder` | 4 | T5 4 | `api:WorldEditorAPI.CreateSubsceneFolder/3`, `mcp:action/wb_layers.createFolder`, `mcp:handler-action/EMCP_WB_Layers.createFolder` |
| `delete` | 3 | T5 3 | `api:WorldEditorAPI.DeleteSubsceneFolder/2`, `mcp:action/wb_layers.delete`, `mcp:handler-action/EMCP_WB_Layers.delete` |
| `getActive` | 2 | T0 1, T5 1 | `mcp:action/wb_layers.getActive`, `mcp:handler-action/EMCP_WB_Layers.getActive` |
| `getEntityLayer` | 2 | T0 1, T3 1 | `mcp:action/wb_layers.getEntityLayer`, `mcp:handler-action/EMCP_WB_Layers.getEntityLayer` |
| `getInfo` | 2 | T0 1, T5 1 | `mcp:action/wb_layers.getInfo`, `mcp:handler-action/EMCP_WB_Layers.getInfo` |
| `isVisible` | 2 | T0 1, T5 1 | `mcp:action/wb_layers.isVisible`, `mcp:handler-action/EMCP_WB_Layers.isVisible` |
| `list` | 2 | T5 2 | `mcp:action/wb_layers.list`, `mcp:handler-action/EMCP_WB_Layers.list` |
| `lock` | 5 | T5 5 | `api:WorldEditorAPI.LockEntityLayer/2`, `api:WorldEditorAPI.UnlockEntityLayer/2`, `mcp:action/wb_layers.lock` |
| `move` | 3 | T5 3 | `api:WorldEditorAPI.SetSubsceneFolderParent/3`, `mcp:action/wb_layers.move`, `mcp:handler-action/EMCP_WB_Layers.move` |
| `rename` | 4 | T5 4 | `api:WorldEditorAPI.RenameSubsceneFolder/3`, `mcp:action/wb_layers.rename`, `mcp:handler-action/EMCP_WB_Layers.rename` |
| `setActive` | 4 | T5 4 | `api:WorldEditorAPI.SetActiveSubsceneLayer/2`, `mcp:action/wb_layers.setActive`, `mcp:handler-action/EMCP_WB_Layers.setActive` |
| `toggleLock` | 2 | T0 1, T3 1 | `mcp:action/wb_layers.toggleLock`, `mcp:handler-action/EMCP_WB_Layers.toggleLock` |
| `tree` | 13 | T5 13 | `api:WorldEditorAPI.GetActiveSubsceneLayer/1`, `api:WorldEditorAPI.GetCurrentEntityLayerId/0`, `api:WorldEditorAPI.GetCurrentSubScene/0` |
| `unlock` | 2 | T5 2 | `mcp:action/wb_layers.unlock`, `mcp:handler-action/EMCP_WB_Layers.unlock` |
