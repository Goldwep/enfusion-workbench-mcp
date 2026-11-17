# ui_extract_strings

```text
Scan a .layout or .c file for hardcoded UI text that should probably be a #AR-key localization token. For .layout: walks the parsed widget tree and flags every `Text`, `Tooltip`, or `Hint` property whose value does not start with `#`. For .c: regex-scans for SetText / Set*-style calls passing a string literal. Pure file parsing — no Workbench connection required.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/ui_extract_strings.md](../../../data/kb/census/tools/ui_extract_strings.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `target_path` | string | yes | Path to a .layout or .c file. Absolute or relative to MCP cwd. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/ui_extract_strings.<action>`. A row that links several actions is counted under each (2 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 2 | T2 2 | `file:.c`, `file:.layout` |
