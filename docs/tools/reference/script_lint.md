# script_lint

```text
Static analysis on an Enforce Script `.c` file. v1 rules: trailing_whitespace, indent_mixed, if_paren_spacing, missing_super_modded, rpc_missing_channel. Ported from BI's Basic Code Formatter Plugin + modding-specific extras. Pass `rules` to enable only a subset (e.g. `["missing_super_modded"]`).
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/script_lint.md](../../../data/kb/census/tools/script_lint.md) |

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `script_path` | string | yes | Path to the .c file (absolute or repo-relative) |
| `rules` | array<string> | no | Subset of rule names to run. Default: all 5. Available: trailing_whitespace / indent_mixed / if_paren_spacing / missing_super_modded / rpc_missing_channel. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/script_lint.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.c` |
