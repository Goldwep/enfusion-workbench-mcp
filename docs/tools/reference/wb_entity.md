# wb_entity

```text
Entities of the open world, by id:, name: or index: reference.
Read:
list: Filtered, paged
get: One entity in detail
children: Direct children, paged
query: In a sphere or box, paged
Mutating:
create: From class or prefab
clone: Copy an entity
delete: One undo step
parent: Under one parent
unparent: To top level
rename: New name
transform: Coords, angles, scale
setLayer: Move to a layer
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Handler contract | `contracts/EMCP_WB_Entity.json` (EMCP_WB_Entity) |
| Census KB page | [data/kb/census/tools/wb_entity.md](../../../data/kb/census/tools/wb_entity.md) |

## Actions (12)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `list` | no | no | Filtered, paged | `parent` (string), `layer` (string), `subScene` (int), `className` (string), `name` (string), `topLevel` (bool), `cursor` (string), `limit` (int) |
| `get` | no | no | One entity in detail | `entity`* (string) |
| `children` | no | no | Direct children, paged | `entity`* (string), `cursor` (string), `limit` (int) |
| `query` | no | no | In a sphere or box, paged | `center` (string), `radius` (float), `mins` (string), `maxs` (string), `cursor` (string), `limit` (int) |
| `create` | yes | yes | From class or prefab | `prefab`* (string), `name` (string), `parent` (string), `layer` (string), `coords` (string), `angles` (string), `placement` (bool) |
| `clone` | yes | yes | Copy an entity | `entity`* (string), `name` (string), `parent` (string), `cloneChildren` (bool) |
| `delete` | yes | yes | One undo step | `entities`* (array<string>) |
| `parent` | yes | yes | Under one parent | `parent`* (string), `entities`* (array<string>), `keepWorldTransform` (bool) |
| `unparent` | yes | yes | To top level | `entities`* (array<string>) |
| `rename` | yes | yes | New name | `entity`* (string), `name`* (string) |
| `transform` | yes | yes | Coords, angles, scale | `entity`* (string), `coords` (string), `angles` (string), `scale` (float) |
| `setLayer` | yes | yes | Move to a layer | `entities`* (array<string>), `layer`* (string), `subScene` (int) |

`*` marks a required parameter of that action.

## Input parameters (22)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `list`, `get`, `children`, `query`, `create`, `clone`, `delete`, `parent`, `unparent`, `rename`, `transform`, `setLayer`. |
| `parent` | string | no | entity ref; children of it only |
| `layer` | string | no | layer path |
| `subScene` | integer | no | filter; default all |
| `className` | string | no | class or prefab substring |
| `name` | string | no | name substring |
| `topLevel` | boolean | no | top-level entities only |
| `cursor` | string | no | nextCursor of the previous page |
| `limit` | integer | no | default 50, max 200 |
| `entity` | string | no | id:<hex> \| name:<n> \| index:<i> |
| `center` | string | no | "x y z" with radius |
| `radius` | number | no |  |
| `mins` | string | no | "x y z" box corner |
| `maxs` | string | no | "x y z" box corner |
| `prefab` | string | no | class name or {GUID}path |
| `coords` | string | no | "x y z" |
| `angles` | string | no | "x y z" |
| `placement` | boolean | no | CreateEntityExt with trace |
| `cloneChildren` | boolean | no | default true |
| `entities` | array<string> | no | refs as entity; max 200 |
| `keepWorldTransform` | boolean | no | default true |
| `scale` | number | no |  |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_entity.<action>`. A row that links several actions is counted under each (58 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `children` | 2 | T5 2 | `mcp:action/wb_entity.children`, `mcp:handler-action/EMCP_WB_Entity.children` |
| `clone` | 3 | T5 3 | `api:WorldEditorAPI.CreateClonedEntity/4`, `mcp:action/wb_entity.clone`, `mcp:handler-action/EMCP_WB_Entity.clone` |
| `create` | 7 | T5 7 | `api:WorldEditorAPI.BeginEntityAction/3`, `api:WorldEditorAPI.CreateEntity/6`, `api:WorldEditorAPI.CreateEntityExt/7` |
| `delete` | 5 | T5 5 | `api:WorldEditorAPI.DeleteEntities/1`, `api:WorldEditorAPI.DeleteEntity/1`, `mcp:action/wb_entity.delete` |
| `get` | 5 | T5 5 | `api:WorldEditorAPI.EntityToSource/1`, `api:WorldEditorAPI.GetEntityNiceName/1`, `api:WorldEditorAPI.GetEntitySubsceneLayer/2` |
| `list` | 6 | T5 6 | `api:WorldEditorAPI.FindEntityByName/1`, `api:WorldEditorAPI.GetEditorEntity/1`, `api:WorldEditorAPI.GetEditorEntityCount/0` |
| `parent` | 7 | T5 7 | `api:WorldEditorAPI.ParentEntities/3`, `api:WorldEditorAPI.ParentEntity/3`, `mcp:action/wb_entity.parent` |
| `query` | 2 | T5 2 | `mcp:action/wb_entity.query`, `mcp:handler-action/EMCP_WB_Entity.query` |
| `rename` | 6 | T5 6 | `api:WorldEditorAPI.RenameEntity/2`, `mcp:action/wb_entity.rename`, `mcp:handler-action/EMCP_WB_Entity.rename` |
| `setLayer` | 6 | T5 6 | `api:WorldEditorAPI.SetEntitySubsceneLayer/3`, `mcp:action/wb_entity.setLayer`, `mcp:handler-action/EMCP_WB_Entity.setLayer` |
| `transform` | 3 | T5 3 | `api:WorldEditorAPI.SetVariableValue/4`, `mcp:action/wb_entity.transform`, `mcp:handler-action/EMCP_WB_Entity.transform` |
| `unparent` | 6 | T5 6 | `api:WorldEditorAPI.RemoveEntityFromParent/1`, `mcp:action/wb_entity.unparent`, `mcp:handler-action/EMCP_WB_Entity.unparent` |
