# refactor_normalize_dependencies

```text
Sort + dedupe + validate a .gproj's Dependencies block. Produces a canonical form. Optional --check_resolution flags deps that don't resolve in the project-index (likely missing Workshop subscriptions). DRY-RUN by default — pass `commit: true` to write. .bak sidecar; git-clean refuse.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/refactor_normalize_dependencies.md](../../../data/kb/census/tools/refactor_normalize_dependencies.md) |

## Input parameters (4)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `gproj_path` | string | yes | Path to the .gproj (absolute or repo-relative) |
| `check_resolution` | boolean | no | If true, also validate each dep GUID resolves in the project-index Default: `false`. |
| `commit` | boolean | no | True to actually write changes. Default: `false`. |
| `force` | boolean | no | Skip git-clean check. Default: `false`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/refactor_normalize_dependencies.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.gproj` |
