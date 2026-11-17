# wb_generator

```text
World Editor generators on shapes: list, attach, detach, regenerate, point data, generator events.
Read:
list: Generators of a shape, or all, paged
Mutating:
attach: Generator prefab as child of a shape
detach: Delete a generator
regenerate: Rebuild a shape's generators
pointData: Add or remove a point's generator data
events: Turn generator events on or off
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Handler contract | `contracts/EMCP_WB_Generator.json` (EMCP_WB_Generator) |
| Census KB page | [data/kb/census/tools/wb_generator.md](../../../data/kb/census/tools/wb_generator.md) |

## Actions (6)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `list` | no | no | Generators of a shape, or all, paged | `shape` (string), `cursor` (string), `limit` (int) |
| `attach` | yes | yes | Generator prefab as child of a shape Refuses: GATED until P-W7-10 passes; NOT_A_GENERATOR when the prefab's class does not inherit GeneratorBaseEntity. | `shape`* (string), `prefab`* (string), `name` (string) |
| `detach` | yes | yes | Delete a generator Refuses: GATED until P-W7-10 passes; NOT_A_GENERATOR when the entity is neither a generator nor a shape with generator children. | `entity`* (string) |
| `regenerate` | yes | yes | Rebuild a shape's generators Refuses: GATED until P-W7-11 picks the route: OnShapeChanged, or a shape re-set in one entity action. | `shape`* (string) |
| `pointData` | yes | yes | Add or remove a point's generator data Refuses: GATED until P-W7-13 passes; NOT_A_SHAPE when shape is not a ShapeEntity. | `shape`* (string), `op`* (string), `index`* (int), `dataClass` (string), `dataIndex` (int) |
| `events` | yes | yes | Turn generator events on or off Refuses: GATED until P-W7-12 passes; editor-wide state, not undoable; list reports it. | `enabled`* (bool) |

`*` marks a required parameter of that action.

## Input parameters (12)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `list`, `attach`, `detach`, `regenerate`, `pointData`, `events`. |
| `shape` | string | no | shape ref; default all |
| `cursor` | string | no | nextCursor of a page |
| `limit` | integer | no | rows per page, max 200 |
| `prefab` | string | no | {GUID}path .et |
| `name` | string | no |  |
| `entity` | string | no | generator or shape ref |
| `op` | string | no | add\|remove |
| `index` | integer | no | point index |
| `dataClass` | string | no | e.g. ForestGeneratorPointData; add |
| `dataIndex` | integer | no | remove; default 0 |
| `enabled` | boolean | no |  |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_generator.<action>`. A row that links several actions is counted under each (6 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `attach` | 1 | T3 1 | `mcp:handler-action/EMCP_WB_Generator.attach` |
| `detach` | 1 | T3 1 | `mcp:handler-action/EMCP_WB_Generator.detach` |
| `events` | 1 | T3 1 | `mcp:handler-action/EMCP_WB_Generator.events` |
| `list` | 1 | T3 1 | `mcp:handler-action/EMCP_WB_Generator.list` |
| `pointData` | 1 | T3 1 | `mcp:handler-action/EMCP_WB_Generator.pointData` |
| `regenerate` | 1 | T3 1 | `mcp:handler-action/EMCP_WB_Generator.regenerate` |
