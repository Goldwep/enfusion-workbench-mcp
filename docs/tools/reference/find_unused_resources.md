# find_unused_resources

```text
List resources with zero inbound references — orphans that no inheritance / asset_path / dep / value entry points at. Use this before publishing a mod to find dead assets you can prune, or for general index hygiene. Read-only; pair with `refactor_remove_unused` (L5) when ready to actually delete. Paginate via `cursor`.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/find_unused_resources.md](../../../data/kb/census/tools/find_unused_resources.md) |

## Input parameters (3)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `source` | string | no | Optional source filter — usually you want `user` to ignore vanilla content One of: `user`, `core`, `workshop`. |
| `limit` | number | no | Max resources per page (1-200, default 50) Default: `50`. |
| `cursor` | string | no | Opaque pagination token from a previous response's next_cursor |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/find_unused_resources.<action>`. A row that links several actions is counted under each (9 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 9 | T2 9 | `file:.conf`, `file:.emat`, `file:.ent` |
