# script_analyze

```text
Parse an Enforce Script `.c` file and emit a structured summary — class declarations (including `modded class`), inheritance, method signatures with attributes (e.g. [RPC], [RplProp]), and fields. Pure FS read; no Workbench connection. Method body content is not parsed — only the structural surface. Foundation tool for `script_overrides`, `script_lint`, `script_class_hierarchy`, `script_find_rpc_handlers`.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/script_analyze.md](../../../data/kb/census/tools/script_analyze.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `script_path` | string | yes | Path to the .c file (absolute or repo-relative) |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/script_analyze.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.c` |
