# project_index_status

```text
Get a snapshot of the project-index — total resources/refs/files indexed plus per-project counts. Use this to verify the indexer is running, debug 'why doesn't find_references see X', or see what's been indexed. Also prunes index rows for projects whose root folder no longer exists and reports how many were removed. Does NOT list individual rows — counts only.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/project_index_status.md](../../../data/kb/census/tools/project_index_status.md) |

## Input parameters (0)

The tool takes no input parameters.

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/project_index_status.<action>`. A row that links several actions is counted under each (9 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 9 | T2 9 | `file:.conf`, `file:.emat`, `file:.ent` |
