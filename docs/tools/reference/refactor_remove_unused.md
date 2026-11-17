# refactor_remove_unused

```text
Emit an executable removal script for resources with zero inbound references. DRY-RUN ONLY at v1 — the tool returns a shell/PowerShell/cmd script for the human to review and execute by hand. Live-delete is intentionally NOT provided to prevent LLM-induced data loss. Composes with `find_unused_resources` for the underlying query.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/refactor_remove_unused.md](../../../data/kb/census/tools/refactor_remove_unused.md) |

## Input parameters (3)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `source` | string | no | Filter — almost always `user` (you don't want to delete core or workshop content) One of: `user`, `core`, `workshop`. |
| `shell` | string | no | Shell flavor for the emitted script One of: `bash`, `powershell`, `cmd`. Default: `"powershell"`. |
| `limit` | number | no | Max candidates to include in the script (default 500) Default: `500`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/refactor_remove_unused.<action>`. A row that links several actions is counted under each (9 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 9 | T2 9 | `file:.conf`, `file:.emat`, `file:.ent` |
