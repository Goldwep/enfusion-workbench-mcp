# scenario_apply_template

```text
Stamp a curated template (`fob_basic` / `checkpoint` / `patrol_grid`) into an existing scenario layer at a world position. Appends the template's entities as new top-level entries; existing entities in the target are left untouched. Placeholder resource refs use sentinel GUIDs that agents are expected to replace via `refactor_replace_guid`. Defaults to `dry_run: true` — stamping mutates layer files, so the safe default is preview-first. Refuses on uncommitted git changes to the target unless `force: true`. Available templates: `fob_basic` (4 sandbag walls + 1 spawn point (5 entities)); `checkpoint` (2 sandbag walls + 1 barrier + 1 watch tower (4 entities)); `patrol_grid` (6 waypoint nodes in a 10m hex (6 entities)).
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/scenario_apply_template.md](../../../data/kb/census/tools/scenario_apply_template.md) |

## Input parameters (6)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `target_layer_path` | string | yes | Absolute path to the target .layer / .conf / .ent file. Must not start with '-' (flag-smuggle guard). |
| `template_name` | string | yes | Which curated template to stamp One of: `fob_basic`, `checkpoint`, `patrol_grid`. |
| `position` | object | yes | World position at which the template's origin is placed. |
| `rotation_yaw_deg` | number | no | Yaw rotation in degrees around the Y axis, applied around `position`. Default 0. Default: `0`. |
| `dry_run` | boolean | no | When true (DEFAULT), don't write — return a plan with entity count and placeholder list. Pass false to actually stamp the template into the target file. Default: `true`. |
| `force` | boolean | no | Bypass the git-clean refusal when writing. Default false. Default: `false`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/scenario_apply_template.<action>`. A row that links several actions is counted under each (4 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 4 | T2 4 | `file:.ent`, `file:.et`, `file:.layer` |
