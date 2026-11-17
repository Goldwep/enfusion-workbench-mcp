# scenario_clone_area

```text
Clone a rectangular world-coord area of a scenario layer file (.conf / .et / .layer) into a new layer file, regenerating every embedded GUID so the clone won't collide with the source. Optionally translates the clones by an X/Z offset. Defaults to writing the destination (use `dry_run: true` to preview the count, sample GUID swaps, and translate vector first). Refuses if the destination exists unless `force: true`, and refuses on uncommitted git changes for the destination unless `force: true`.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/scenario_clone_area.md](../../../data/kb/census/tools/scenario_clone_area.md) |

## Input parameters (6)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `source_layer_path` | string | yes | Absolute path to the source .conf / .et / .layer file. Must not start with '-' (flag-smuggle guard). |
| `dest_layer_path` | string | yes | Absolute path where the cloned layer will be written. Must not start with '-' (flag-smuggle guard). Refuses if the file already exists unless `force: true`. |
| `area` | object | yes | Axis-aligned rectangle on the world XZ plane. Top-level entities whose coords' first and third components fall inside this rectangle are cloned. |
| `translate` | object | no | Optional offset to apply to every cloned entity's coords. Default no translation. |
| `dry_run` | boolean | no | When true, parse + filter + plan but DO NOT write. Default false — this tool's job is to extract a region. Default: `false`. |
| `force` | boolean | no | Allow overwrite of an existing destination, and bypass the git-clean refusal. Default false. Default: `false`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/scenario_clone_area.<action>`. A row that links several actions is counted under each (4 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 4 | T2 4 | `file:.conf`, `file:.ent`, `file:.layer` |
