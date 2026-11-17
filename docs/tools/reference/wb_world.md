# wb_world

```text
The open world.
Read:
state: Mode, tool, path, sub-scenes
browserSelection: Resource Browser selection
playEvents: Play events after seq
comments: Comment entities, paged
Mutating:
register: Write a file's .meta; confirm
play: Enter play mode
stop: Leave play mode
addComment: New comment entity
annotate: Add, move, remove an entity note
Offline (confirm): new, duplicate, saveAs, setWorldEntity
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Handler contract | `contracts/EMCP_WB_World.json` (EMCP_WB_World) |
| Census KB page | [data/kb/census/tools/wb_world.md](../../../data/kb/census/tools/wb_world.md) |

## Actions (9)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `state` | no | no | Mode, tool, path, sub-scenes | none |
| `browserSelection` | no | no | Resource Browser selection | `recursive` (bool) |
| `register` | yes | yes | Write a file's .meta; confirm | `path`* (string), `confirm` (bool) |
| `play` | yes | yes | Enter play mode | `debugMode` (bool), `fullScreen` (bool) |
| `stop` | yes | yes | Leave play mode | none |
| `playEvents` | no | no | Play events after seq | `after` (int) |
| `comments` | no | no | Comment entities, paged | `cursor` (string), `limit` (int) |
| `addComment` | yes | yes | New comment entity | `text`* (string), `coords`* (string), `color` (string), `size` (float), `layer` (string) |
| `annotate` | yes | yes | Add, move, remove an entity note | `entity`* (string), `mode`* (string), `text` (string), `category` (string), `color` (string), `size` (float), `coords` (string) |

`*` marks a required parameter of that action.

## Input parameters (20)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `state`, `browserSelection`, `register`, `play`, `stop`, `playEvents`, `comments`, `addComment`, `annotate`, `new`, `duplicate`, `saveAs`, `setWorldEntity`. |
| `recursive` | boolean | no | default false |
| `path` | string | no | register: project-relative file; new, duplicate, setWorldEntity: the .ent |
| `confirm` | boolean | no | register and offline writers: true writes; else a dry run |
| `debugMode` | boolean | no |  |
| `fullScreen` | boolean | no |  |
| `after` | integer | no | seq; default 0 |
| `cursor` | string | no | <start>:<count> of the previous page |
| `limit` | integer | no | default 50, max 200 |
| `text` | string | no |  |
| `coords` | string | no | "x y z" |
| `color` | string | no | "r g b" 0..1 |
| `size` | number | no | metres |
| `layer` | string | no | layer path |
| `entity` | string | no | id:<hex> \| name:<n> \| index:<i> |
| `mode` | string | no | add, move or remove |
| `category` | string | no | add only |
| `to` | string | no | duplicate, saveAs: the new .ent (project-relative) |
| `prefab` | string | no | new, setWorldEntity: world entity prefab {GUID}path.et; empty = plain |
| `overwrite` | boolean | no | new, duplicate, saveAs: write over existing files |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_world.<action>`. A row that links several actions is counted under each (36 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `addComment` | 2 | T5 2 | `mcp:action/wb_world.addComment`, `mcp:handler-action/EMCP_WB_World.addComment` |
| `annotate` | 2 | T5 2 | `mcp:action/wb_world.annotate`, `mcp:handler-action/EMCP_WB_World.annotate` |
| `browserSelection` | 3 | T5 3 | `api:WorldEditor.GetResourceBrowserSelection/2`, `mcp:action/wb_world.browserSelection`, `mcp:handler-action/EMCP_WB_World.browserSelection` |
| `comments` | 3 | T4 1, T5 2 | `api:WorldEditorAPI.GetCommentCategories/1`, `mcp:action/wb_world.comments`, `mcp:handler-action/EMCP_WB_World.comments` |
| `play` | 4 | T5 4 | `api:WorldEditor.SwitchToGameMode/2`, `mcp:action/wb_world.play`, `mcp:handler-action/EMCP_WB_World.play` |
| `playEvents` | 4 | T5 4 | `api:WorldEditorPlugin.OnGameModeEnded/0`, `api:WorldEditorPlugin.OnGameModeStarted/5`, `mcp:action/wb_world.playEvents` |
| `register` | 2 | T5 2 | `mcp:action/wb_world.register`, `mcp:handler-action/EMCP_WB_World.register` |
| `state` | 13 | T5 13 | `api:WorldEditor.GetApi/0`, `api:WorldEditorAPI.AreGeneratorEventsEnabled/0`, `api:WorldEditorAPI.GetCurrentToolName/0` |
| `stop` | 3 | T5 3 | `api:WorldEditor.SwitchToEditMode/0`, `mcp:action/wb_world.stop`, `mcp:handler-action/EMCP_WB_World.stop` |
