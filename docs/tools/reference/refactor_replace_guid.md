# refactor_replace_guid

```text
Swap one 16-hex GUID for another across the project. Updates the owning resource's own GUID (a .gproj `GUID`, or the `Name` line of its `.meta` sidecar, found on disk when the index has no row) AND every braced/bare reference to it across all indexed files, plus braced `{GUID}` references in text files the index does not scan (e.g. .physmat; binaries and .bak skipped). Default mode is DRY-RUN — produces a plan. Pass `commit: true` to actually write. Refuses on collision (new GUID already names another resource), on uncommitted git changes (use `force: true` to override), or no-op (old == new). When no editable owner is found the dry run says so and a commit refuses with an error, unless `references_only: true`. Only files in `user` projects are edited by default — workshop files need `include_workshop: true`, core files are never touched. Atomic: any mid-write failure rolls every modified file back from .bak sidecars.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/refactor_replace_guid.md](../../../data/kb/census/tools/refactor_replace_guid.md) |

## Input parameters (6)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `old_guid` | string | yes | Existing GUID to replace (16 hex, with or without braces) |
| `new_guid` | string | yes | Replacement GUID (16 hex, with or without braces). Must not name an existing resource. |
| `commit` | boolean | no | When true, atomically writes the changes. Default false = dry-run only. Default: `false`. |
| `force` | boolean | no | Bypass the uncommitted-changes refusal (skips git-clean check). Default: `false`. |
| `include_workshop` | boolean | no | Also edit files inside Steam-workshop projects. Default false: only `user` projects are edited; core files are never edited. Default: `false`. |
| `references_only` | boolean | no | Commit even when no editable resource owns old_guid: rewrites the references only, leaving them on a GUID no resource owns. Default false refuses. Default: `false`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/refactor_replace_guid.<action>`. A row that links several actions is counted under each (6 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 6 | T2 6 | `file:.conf`, `file:.ent`, `file:.et` |
