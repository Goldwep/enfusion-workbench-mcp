# ui_layout_inspect

```text
Parse a `.layout` file and emit an ASCII widget tree with key properties per node (class type, Name, anchor, offset, width/height). Static analysis — pure file parsing, no Workbench connection required.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/ui_layout_inspect.md](../../../data/kb/census/tools/ui_layout_inspect.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `layout_path` | string | yes | Path to a .layout file. Absolute or relative to MCP cwd. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/ui_layout_inspect.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.layout` |
