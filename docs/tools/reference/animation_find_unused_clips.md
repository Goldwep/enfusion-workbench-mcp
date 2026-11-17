# animation_find_unused_clips

```text
Read-only scan for `.anm` clips that no AGF, ASI, AGR or character `.conf` references; never deletes. Run it before publishing a mod to prune dead clips. Scans the configured project root; `include_workshop: true` adds workshop roots from the ProjectIndex. `format`: markdown (default) or json. Scope and output: KB anim-lint-tools.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/animation_find_unused_clips.md](../../../data/kb/census/tools/animation_find_unused_clips.md) |

## Input parameters (3)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `project_path` | string | no | Project root to scan. Defaults to the configured projectPath. Must not start with '-' (flag-smuggle guard). |
| `include_workshop` | boolean | no | When true, also scan workshop projects discovered in the ProjectIndex. When false (default), only scan the user-mod project root. Default: `false`. |
| `format` | string | no | Output format. `markdown` (default) renders a table; `json` returns the raw struct. One of: `markdown`, `json`. Default: `"markdown"`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/animation_find_unused_clips.<action>`. A row that links several actions is counted under each (5 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 5 | T2 5 | `file:.agf`, `file:.agr`, `file:.anm` |
