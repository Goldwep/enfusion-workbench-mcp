# world_diff

```text
Semantic diff between two Enfusion text files (typically `.ent` worlds or `.layer` files). Groups direct-child entities by stable key (id → type+position → array index) and reports added/removed/moved/modified buckets. Useful for reviewing what changed between two versions of a layer before merging from a beta branch. Pure file I/O — no project-index required.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/world_diff.md](../../../data/kb/census/tools/world_diff.md) |

## Input parameters (4)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `before_path` | string | yes | Absolute path to the pre-change .ent/.layer file |
| `after_path` | string | yes | Absolute path to the post-change .ent/.layer file |
| `position_epsilon` | number | no | Transforms differing by less than this (per axis) are treated as the same position. Default 0.01. Default: `0.01`. |
| `max_diffs` | integer | no | Cap on entries shown per section. Counts are still reported in full. Default 100. Default: `100`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/world_diff.<action>`. A row that links several actions is counted under each (2 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 2 | T2 2 | `file:.ent`, `file:.layer` |
