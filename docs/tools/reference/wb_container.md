# wb_container

```text
A BaseContainer. target: path:<rel> | open:<module> | entity:<ref> | class:<Name> (read)
Read:
describe: Schema and values, paged
get: One path: value, flags, schema
Mutating:
set: Set a scalar
clear: Drop an override
arrayAdd: Add an element
arrayRemove: Remove an element
arrayMove: Move an element
setClass: Set a property class
save: Re-save
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Handler contract | `contracts/EMCP_WB_Container.json` (EMCP_WB_Container) |
| Census KB page | [data/kb/census/tools/wb_container.md](../../../data/kb/census/tools/wb_container.md) |

## Actions (9)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `describe` | no | no | Schema and values, paged | `target`* (string), `mode` (string), `cursor` (string), `limit` (int), `fields` (string) |
| `get` | no | no | One path: value, flags, schema | `target`* (string), `path`* (string) |
| `set` | yes | yes | Set a scalar | `target`* (string), `path`* (string), `value`* (string), `emptyValue` (bool), `confirm` (bool) |
| `clear` | yes | yes | Drop an override | `target`* (string), `path`* (string), `confirm` (bool) |
| `arrayAdd` | yes | yes | Add an element | `target`* (string), `path`* (string), `className`* (string), `index` (int), `confirm` (bool) |
| `arrayRemove` | yes | yes | Remove an element | `target`* (string), `path`* (string), `index`* (int), `confirm` (bool) |
| `arrayMove` | yes | yes | Move an element Refuses: UNPROVEN for an entity:<ref> target: SetObjectVariableMember/4 names no array slot (probe P-W1-22); path: targets move. | `target`* (string), `path`* (string), `index`* (int), `toIndex`* (int), `confirm` (bool) |
| `setClass` | yes | yes | Set a property class | `target`* (string), `path`* (string), `className`* (string), `confirm` (bool) |
| `save` | yes | yes | Re-save | `target`* (string), `confirm` (bool) |

`*` marks a required parameter of that action.

## Input parameters (13)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `describe`, `get`, `set`, `clear`, `arrayAdd`, `arrayRemove`, `arrayMove`, `setClass`, `save`. |
| `target` | string | no | path:, open:<module>, entity:, class: |
| `mode` | string | no | summary (default) or page |
| `cursor` | string | no | nextCursor of the previous page |
| `limit` | integer | no | rows per page, default 100, max 200 |
| `fields` | string | no | columns; schema adds widget,limits,enum |
| `path` | string | no | dotted; X[Class] ok; #i. child node |
| `value` | string | no | new value as text |
| `emptyValue` | boolean | no | set by the tool for an empty value |
| `confirm` | boolean | no | path:/open: true writes, else a dry run |
| `className` | string | no | class of the new element |
| `index` | integer | no | insert position; -1 (default) = end |
| `toIndex` | integer | no | its position after the move |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_container.<action>`. A row that links several actions is counted under each (25 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `arrayAdd` | 3 | T4 2, T5 1 | `api:WorldEditorAPI.CreateObjectArrayVariableMember/5`, `mcp:action/wb_container.arrayAdd`, `mcp:handler-action/EMCP_WB_Container.arrayAdd` |
| `arrayMove` | 2 | T3 2 | `mcp:action/wb_container.arrayMove`, `mcp:handler-action/EMCP_WB_Container.arrayMove` |
| `arrayRemove` | 3 | T4 2, T5 1 | `api:WorldEditorAPI.RemoveObjectArrayVariableMember/4`, `mcp:action/wb_container.arrayRemove`, `mcp:handler-action/EMCP_WB_Container.arrayRemove` |
| `clear` | 3 | T5 3 | `api:WorldEditorAPI.ClearVariableValue/3`, `mcp:action/wb_container.clear`, `mcp:handler-action/EMCP_WB_Container.clear` |
| `describe` | 4 | T3 2, T5 2 | `api:WBModuleDef.GetContainer/1`, `api:WBModuleDef.GetNumContainers/0`, `mcp:action/wb_container.describe` |
| `get` | 2 | T5 2 | `mcp:action/wb_container.get`, `mcp:handler-action/EMCP_WB_Container.get` |
| `save` | 3 | T3 1, T4 2 | `api:WBModuleDef.Save/0`, `mcp:action/wb_container.save`, `mcp:handler-action/EMCP_WB_Container.save` |
| `set` | 2 | T4 2 | `mcp:action/wb_container.set`, `mcp:handler-action/EMCP_WB_Container.set` |
| `setClass` | 3 | T5 3 | `api:WorldEditorAPI.ChangeObjectClass/3`, `mcp:action/wb_container.setClass`, `mcp:handler-action/EMCP_WB_Container.setClass` |
