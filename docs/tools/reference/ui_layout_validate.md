# ui_layout_validate

```text
Lint a .layout file for duplicate widget names, malformed / out-of-range anchors, empty Name properties, and unknown style references. When a ProjectIndex is supplied, style refs (`m_sStyleName`) are cross-checked against indexed .styles files. Pure file parsing — no Workbench connection required.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/ui_layout_validate.md](../../../data/kb/census/tools/ui_layout_validate.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `layout_path` | string | yes | Path to a .layout file. Absolute or relative to MCP cwd. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/ui_layout_validate.<action>`. A row that links several actions is counted under each (2 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 2 | T2 2 | `file:.layout`, `file:.styles` |
