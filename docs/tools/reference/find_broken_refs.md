# find_broken_refs

```text
Find references pointing at GUIDs not in the resources table. Catches both real bugs (asset/inheritance refs to deleted resources) and missing-dependency cases (deps to projects you don't have indexed). Run before publishing to catch the most common ship-blocker. Paginate via `cursor`.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/find_broken_refs.md](../../../data/kb/census/tools/find_broken_refs.md) |

## Input parameters (3)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `source` | string | no | Filter by the source of the file containing the broken ref One of: `user`, `core`, `workshop`. |
| `limit` | number | no | Max refs per page (1-200, default 50) Default: `50`. |
| `cursor` | string | no | Opaque pagination token from a previous response's next_cursor |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/find_broken_refs.<action>`. A row that links several actions is counted under each (9 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 9 | T2 9 | `file:.conf`, `file:.emat`, `file:.ent` |
