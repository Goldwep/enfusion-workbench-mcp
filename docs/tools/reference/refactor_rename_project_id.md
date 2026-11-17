# refactor_rename_project_id

```text
Rename the `ID` property of a `.gproj` file. Surgical single-line edit. DRY-RUN by default — pass `commit: true` to actually write. Refuses on uncommitted git changes (use `force: true`). Note: project_id is the FK column on resources (schema v2). After commit, re-run the crawl to refresh the index.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/refactor_rename_project_id.md](../../../data/kb/census/tools/refactor_rename_project_id.md) |

## Input parameters (5)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `gproj_path` | string | yes | Path to the .gproj file (absolute or repo-relative) |
| `old_id` | string | yes | Current ID value (the string inside `ID "..."`) |
| `new_id` | string | yes | New ID value. Letters / digits / underscore / hyphen / dot only. |
| `commit` | boolean | no | Set true to actually write. Default: `false`. |
| `force` | boolean | no | Skip git-clean check. Default: `false`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/refactor_rename_project_id.<action>`. A row that links several actions is counted under each (2 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 2 | T2 2 | `file:.gproj`, `mcp:action/refactor_rename_project_id.run` |
