# terrain_road_export_graph

```text
1.x alias, now built from wb_generator list and wb_shape points: the road generators of the open world as a graph (nodes, edges with length). Points within 1 m merge into one node. No road width is read. world_path is optional: the open world is read, and another world is refused.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/terrain_road_export_graph.md](../../../data/kb/census/tools/terrain_road_export_graph.md) |

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `world_path` | string | no | Optional: must name the open world; roads are read from the open world. |
| `format` | string | no | Output format. json = raw graph data; mermaid = visualizable diagram One of: `json`, `mermaid`. Default: `"json"`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/terrain_road_export_graph.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `mcp:handler-action/EMCP_WB_Terrain.road_export_graph` |
