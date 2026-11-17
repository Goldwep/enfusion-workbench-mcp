# wb_build_data

```text
Build packed .pak data for a project: -wbModule=ResourceManager -buildData <platform> <outDir> -gproj <gproj> (unresolved: the -buildData plus -gproj form is unmeasured, DEC-047 L7).
Mutating: spawns its own Workbench, refused while one runs; writes out_dir; success needs a fresh file there. run, or start then poll a job_id.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/wb_build_data.md](../../../data/kb/census/tools/wb_build_data.md) |

## Actions (3)

`run`, `start`, `poll`

## Input parameters (7)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | no | `run` (default): build synchronously and report. `start`: launch the build as a background job and return its job_id at once. `poll`: report the status/result of a job_id. One of: `run`, `start`, `poll`. Default: `"run"`. |
| `job_id` | string | no | Job id from a previous `start` — required for `poll`, ignored otherwise |
| `gproj_path` | string | no | Path to the .gproj (absolute or repo-relative). Required for `run`/`start`. |
| `out_dir` | string | no | Output directory (will be created if missing). Absolute or relative to cwd. Required for `run`/`start`. |
| `platform` | string | no | Target platform for pak output One of: `PC`, `XBOX_ONE`, `XBOX_SERIES`, `PS4`, `PS5`. Default: `"PC"`. |
| `timeout_seconds` | number | no | Wall-clock timeout in seconds (10-1800, default 100). Raise it explicitly for big builds, or use action:"start". Default: `100`. |
| `launcher_nudge` | boolean | no | Auto-confirm the launcher's project picker by restoring its window and posting Enter when it holds instead of auto-opening (Windows only) Default: `true`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_build_data.<action>`. A row that links several actions is counted under each (11 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `poll` | 4 | T2 3, T3 1 | `cli:-builddata`, `cli:-gproj`, `cli:-wbmodule` |
| `run` | 3 | T2 3 | `cli:-builddata`, `cli:-gproj`, `cli:-wbmodule` |
| `start` | 4 | T2 3, T3 1 | `cli:-builddata`, `cli:-gproj`, `cli:-wbmodule` |
