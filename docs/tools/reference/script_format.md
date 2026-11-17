# script_format

```text
Apply safe formatting fixes to an Enforce Script `.c` file: strip trailing whitespace, ensure single trailing newline, collapse blank-line runs. DRY-RUN by default — pass `commit: true` to write. Atomic-commit with .bak sidecar; git-clean refuse. Riskier reformats (indent normalization, `if(` style) are intentionally NOT applied — use `script_lint` to surface those for human decision.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/script_format.md](../../../data/kb/census/tools/script_format.md) |

## Input parameters (3)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `script_path` | string | yes | Path to the .c file (absolute or repo-relative) |
| `commit` | boolean | no | True to actually write. Default: `false`. |
| `force` | boolean | no | Skip git-clean check. Default: `false`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/script_format.<action>`. A row that links several actions is counted under each (2 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 2 | T0 1, T2 1 | `file:.c`, `mcp:action/script_format.run` |
