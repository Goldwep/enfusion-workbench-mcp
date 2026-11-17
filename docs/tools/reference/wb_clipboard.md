# wb_clipboard

```text
Clipboard operations in the World Editor. Copy, cut, paste, paste at cursor, duplicate selected entities, or check if clipboard has content. Paste/cut/duplicate only work in edit mode.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/wb_clipboard.md](../../../data/kb/census/tools/wb_clipboard.md) |

## Actions (6)

`copy`, `cut`, `paste`, `pasteAtCursor`, `duplicate`, `hasCopied`

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | Clipboard action: copy/cut (selected entities to clipboard), paste (at original position), pasteAtCursor (at cursor position), duplicate (copy+paste in place), hasCopied (check clipboard) One of: `copy`, `cut`, `paste`, `pasteAtCursor`, `duplicate`, `hasCopied`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_clipboard.<action>`. A row that links several actions is counted under each (12 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `copy` | 2 | T2 1, T3 1 | `mcp:action/wb_clipboard.copy`, `mcp:handler-action/EMCP_WB_Clipboard.copy` |
| `cut` | 2 | T2 1, T3 1 | `mcp:action/wb_clipboard.cut`, `mcp:handler-action/EMCP_WB_Clipboard.cut` |
| `duplicate` | 2 | T2 1, T3 1 | `mcp:action/wb_clipboard.duplicate`, `mcp:handler-action/EMCP_WB_Clipboard.duplicate` |
| `hasCopied` | 2 | T2 1, T3 1 | `mcp:action/wb_clipboard.hasCopied`, `mcp:handler-action/EMCP_WB_Clipboard.hasCopied` |
| `paste` | 2 | T2 1, T3 1 | `mcp:action/wb_clipboard.paste`, `mcp:handler-action/EMCP_WB_Clipboard.paste` |
| `pasteAtCursor` | 2 | T2 1, T3 1 | `mcp:action/wb_clipboard.pasteAtCursor`, `mcp:handler-action/EMCP_WB_Clipboard.pasteAtCursor` |
