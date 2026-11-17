# wb_shape

```text
World Editor shapes: read points; create, edit, area, shapefile import, parallel copies.
Read:
points: Shape class, closed flag and points, paged; tesselated
Mutating:
create: Polyline or spline from points
area: (TS) circle, rectangle or star outline
import: (TS) shapefile lines and polygons
parallel: Offset copies of a shape
edit: Set, insert, remove, move points; open or close
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Handler contract | `contracts/EMCP_WB_Shape.json` (EMCP_WB_Shape) |
| Census KB page | [data/kb/census/tools/wb_shape.md](../../../data/kb/census/tools/wb_shape.md) |

## Actions (6)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `points` | no | no | Shape class, closed flag and points, paged; tesselated | `entity`* (string), `cursor` (string), `limit` (int), `tesselated` (bool) |
| `create` | yes | yes | Polyline or spline from points | `points`* (array<string>), `closed` (bool), `spline` (bool), `layer` (string), `name` (string), `color` (string), `parent` (string) |
| `area` | yes | yes | (TS) circle, rectangle or star outline Refuses: Served by the TS tool: SCR_ShapeAreaTool maths, heights via wb_terrain heights, then create (or edit set with target). | `shape`* (string), `centre` (string), `width`* (float), `length` (float), `segments` (int), `branches` (int), `innerRatio` (float), `snapToGround` (bool), `closed` (bool), `spline` (bool), `layer` (string), `target` (string) |
| `import` | yes | yes | (TS) shapefile lines and polygons Refuses: Served by the TS tool: parses .shp and .dbf in the project, then calls create per record. Point records are reported, not placed. | `path`* (string), `offset` (string), `spline` (bool), `color` (string), `layer` (string), `cursor` (string), `limit` (int) |
| `parallel` | yes | yes | Offset copies of a shape Refuses: GATED until probe P-W6-16 passes (a handler calling SCR_ParallelShapeHelper is unproven); the main session opens it. | `entity`* (string), `offsets`* (array<string>), `minDistance` (float), `snapToGround` (bool), `spline` (bool), `asChild` (bool) |
| `edit` | yes | yes | Set, insert, remove, move points; open or close Refuses: GATED until P-W7-14 passes. | `entity`* (string), `op`* (string), `index` (int), `points` (array<string>), `snapToGround` (bool) |

`*` marks a required parameter of that action.

## Input parameters (28)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `points`, `create`, `area`, `import`, `parallel`, `edit`. |
| `entity` | string | no | id:<hex> \| name:<n> \| index:<i> |
| `cursor` | string | no | nextCursor of a page |
| `limit` | integer | no | rows per page, max 200 |
| `tesselated` | boolean | no | tesselated points instead |
| `points` | array<string> | no | "x y z" world; 2 to 2000 |
| `closed` | boolean | no | default false |
| `spline` | boolean | no | SplineShapeEntity; default polyline |
| `layer` | string | no | layer path; default active |
| `name` | string | no | default: generated |
| `color` | string | no | "r g b a" 0..1 |
| `parent` | string | no | entity ref |
| `shape` | string | no | circle\|rectangle\|star |
| `centre` | string | no | "x y z"; default camera trace |
| `width` | number | no | metres |
| `length` | number | no | metres; default width |
| `segments` | integer | no | circle segments or per side |
| `branches` | integer | no | star branches, default 5 |
| `innerRatio` | number | no | star inner radius, 0..1 |
| `snapToGround` | boolean | no | y from terrain |
| `target` | string | no | existing shape ref: replace its points |
| `path` | string | no | project-relative .shp |
| `offset` | string | no | "x y z" added to every vertex |
| `offsets` | array<string> | no | metres as text; max 16 |
| `minDistance` | number | no | point thinning, metres |
| `asChild` | boolean | no | parent copies to the source |
| `op` | string | no | set\|insert\|remove\|move\|open\|close |
| `index` | integer | no | point index; insert, remove, move |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_shape.<action>`. A row that links several actions is counted under each (10 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `area` | 2 | T5 2 | `mcp:action/wb_shape.area`, `mcp:handler-action/EMCP_WB_Shape.area` |
| `create` | 2 | T5 2 | `mcp:action/wb_shape.create`, `mcp:handler-action/EMCP_WB_Shape.create` |
| `edit` | 1 | T3 1 | `mcp:handler-action/EMCP_WB_Shape.edit` |
| `import` | 2 | T5 2 | `mcp:action/wb_shape.import`, `mcp:handler-action/EMCP_WB_Shape.import` |
| `parallel` | 1 | T3 1 | `mcp:handler-action/EMCP_WB_Shape.parallel` |
| `points` | 2 | T5 2 | `mcp:action/wb_shape.points`, `mcp:handler-action/EMCP_WB_Shape.points` |
