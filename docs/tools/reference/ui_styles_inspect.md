# ui_styles_inspect

```text
Parse a .styles file and emit a markdown summary of every widget-style entry with its property list. Pure file parsing — no Workbench connection required.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/ui_styles_inspect.md](../../../data/kb/census/tools/ui_styles_inspect.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `styles_path` | string | yes | Path to a .styles file. Absolute or relative to MCP cwd. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/ui_styles_inspect.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.styles` |
