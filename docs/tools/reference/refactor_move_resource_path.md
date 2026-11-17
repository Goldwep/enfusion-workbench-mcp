# refactor_move_resource_path

```text
Rename/move a resource file on disk and update every `{GUID}<oldPath>` reference across the project to point at the new path. GUID stays; path bytes change. DRY-RUN by default — pass `commit: true` to write. The `<file>.meta` sidecar (GUID + import settings) moves with the file and its `Name "{GUID}path"` line is rewritten to the new path; the dry-run lists both files. Order on commit: file rename first (a failed rename touches nothing), then the sidecar, THEN atomic ref updates — a failure rolls the refs back and undoes the sidecar and file renames. Refuses on collision (destination file or destination `.meta`), missing source, or no GUID (.meta or index). Not verified live: how Workbench treats an offline move on its next open. Paths are project-relative (forward slashes), resolved against the supplied project_root.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/refactor_move_resource_path.md](../../../data/kb/census/tools/refactor_move_resource_path.md) |

## Input parameters (5)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `project_root` | string | yes | Absolute path to the owning project (the .gproj directory) |
| `old_path` | string | yes | Existing resource path relative to project_root (e.g. 'prefabs/base.et') |
| `new_path` | string | yes | New path relative to project_root. Intermediate directories are created. |
| `commit` | boolean | no | True to write. Default: `false`. |
| `force` | boolean | no | Skip git-clean check. Default: `false`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/refactor_move_resource_path.<action>`. A row that links several actions is counted under each (7 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 7 | T2 7 | `file:.conf`, `file:.ent`, `file:.et` |
