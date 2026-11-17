# script_extract_interface

```text
Emit the public-facing surface of a class as readable markdown. Filters out `protected` and `private` methods/fields. Use for handoff docs, API audits, or feeding the public surface back to an LLM as compact context.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/script_extract_interface.md](../../../data/kb/census/tools/script_extract_interface.md) |

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `script_path` | string | yes | Path to the .c file (absolute or repo-relative) |
| `class_name` | string | no | Optional — restrict output to a specific class. Default: all classes in the file. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/script_extract_interface.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.c` |
