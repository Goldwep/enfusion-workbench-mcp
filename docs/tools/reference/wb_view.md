# wb_view

```text
World Editor selection, visibility and camera.
Read:
selection: Selected entities, paged
camera: Position, angles, screen size
trace: Ray from a pixel: hit and entity
underCursor: Entity under the mouse
Mutating:
select: Set, add, remove or clear selection
setVisible: Hide or show entities
setCamera: Move the camera
focus: Aim the camera at an entity
placeAtPixel: Create an entity at a pixel
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Handler contract | `contracts/EMCP_WB_View.json` (EMCP_WB_View) |
| Census KB page | [data/kb/census/tools/wb_view.md](../../../data/kb/census/tools/wb_view.md) |

## Actions (9)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `selection` | no | no | Selected entities, paged | `cursor` (string), `limit` (int) |
| `select` | yes | yes | Set, add, remove or clear selection | `mode`* (string), `entities` (array<string>) |
| `setVisible` | yes | yes | Hide or show entities | `entities`* (array<string>), `visible`* (bool), `recursive` (bool) |
| `camera` | no | no | Position, angles, screen size | none |
| `setCamera` | yes | yes | Move the camera | `coords`* (string), `look`* (string) |
| `focus` | yes | yes | Aim the camera at an entity | `entity`* (string), `distance` (float) |
| `trace` | no | no | Ray from a pixel: hit and entity | `x`* (int), `y`* (int), `flags` (string) |
| `underCursor` | no | no | Entity under the mouse | `clamped` (bool) |
| `placeAtPixel` | yes | yes | Create an entity at a pixel | `x`* (int), `y`* (int), `prefab`* (string), `name` (string), `layer` (string), `window` (int) |

`*` marks a required parameter of that action.

## Input parameters (19)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `selection`, `select`, `setVisible`, `camera`, `setCamera`, `focus`, `trace`, `underCursor`, `placeAtPixel`. |
| `cursor` | string | no | nextCursor of the previous page |
| `limit` | integer | no | default 50, max 200 |
| `mode` | string | no | set, add, remove or clear |
| `entities` | array<string> | no | refs; not for clear |
| `visible` | boolean | no |  |
| `recursive` | boolean | no | default true |
| `coords` | string | no | "x y z" |
| `look` | string | no | "x y z" look direction |
| `entity` | string | no | id:<hex> \| name:<n> \| index:<i> |
| `distance` | number | no | metres; default frames the bounds |
| `x` | integer | no | viewport pixel |
| `y` | integer | no | viewport pixel |
| `flags` | string | no | TraceFlags names, comma-joined |
| `clamped` | boolean | no | clamp to the viewport |
| `prefab` | string | no | class name or {GUID}path |
| `name` | string | no |  |
| `layer` | string | no | layer path; default active |
| `window` | integer | no | window type, default 0 |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_view.<action>`. A row that links several actions is counted under each (44 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `camera` | 5 | T5 5 | `api:WorldEditorAPI.GetScreenHeight/0`, `api:WorldEditorAPI.GetScreenWidth/0`, `api:WorldEditorAPI.GetWorld/0` |
| `focus` | 5 | T5 5 | `mcp:action/wb_view.focus`, `mcp:handler-action/EMCP_WB_View.focus`, `ui:WorldEditor/context-item/Hierarchy/entity/Focus Selection` |
| `placeAtPixel` | 3 | T5 3 | `api:WorldEditorAPI.CreateEntityInWindowEx/6`, `mcp:action/wb_view.placeAtPixel`, `mcp:handler-action/EMCP_WB_View.placeAtPixel` |
| `select` | 7 | T5 7 | `api:WorldEditorAPI.AddToEntitySelection/1`, `api:WorldEditorAPI.ClearEntitySelection/0`, `api:WorldEditorAPI.RemoveFromEntitySelection/1` |
| `selection` | 6 | T4 1, T5 5 | `api:WorldEditorAPI.GetSelectedEntitiesCount/0`, `api:WorldEditorAPI.GetSelectedEntity/1`, `api:WorldEditorAPI.IsEntitySelected/1` |
| `setCamera` | 3 | T5 3 | `api:WorldEditorAPI.SetCamera/2`, `mcp:action/wb_view.setCamera`, `mcp:handler-action/EMCP_WB_View.setCamera` |
| `setVisible` | 7 | T5 7 | `api:WorldEditorAPI.IsEntityVisible/1`, `api:WorldEditorAPI.SetEntityVisible/3`, `mcp:action/wb_view.setVisible` |
| `trace` | 3 | T5 3 | `api:WorldEditorAPI.TraceWorldPos/7`, `mcp:action/wb_view.trace`, `mcp:handler-action/EMCP_WB_View.trace` |
| `underCursor` | 5 | T5 5 | `api:WorldEditorAPI.GetEntityUnderCursor/0`, `api:WorldEditorAPI.GetMousePosX/1`, `api:WorldEditorAPI.GetMousePosY/1` |
