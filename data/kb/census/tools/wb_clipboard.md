# Tool: wb_clipboard

Clipboard operations in the World Editor.

Row: mcp:tool/wb_clipboard. Tier T2/T2.

## Actions (6)

| action | risk | what |
| --- | --- | --- |
| copy | mutating | mcp action 'wb_clipboard.copy' in WorldEditor under wb_clipboard |
| cut | mutating | mcp action 'wb_clipboard.cut' in WorldEditor under wb_clipboard |
| duplicate | mutating | copy+paste in place |
| hasCopied | safe | check clipboard |
| paste | mutating | at original position |
| pasteAtCursor | mutating | at cursor position |

## Rows linked to this tool (12)

- mcp:action/wb_clipboard.copy (copy drive)
- mcp:action/wb_clipboard.cut (cut drive)
- mcp:action/wb_clipboard.duplicate (duplicate drive)
- mcp:action/wb_clipboard.hasCopied (hasCopied drive)
- mcp:action/wb_clipboard.paste (paste drive)
- mcp:action/wb_clipboard.pasteAtCursor (pasteAtCursor drive)
- mcp:handler-action/EMCP_WB_Clipboard.copy (copy read)
- mcp:handler-action/EMCP_WB_Clipboard.cut (cut read)
- mcp:handler-action/EMCP_WB_Clipboard.duplicate (duplicate read)
- mcp:handler-action/EMCP_WB_Clipboard.hasCopied (hasCopied read)
- mcp:handler-action/EMCP_WB_Clipboard.paste (paste read)
- mcp:handler-action/EMCP_WB_Clipboard.pasteAtCursor (pasteAtCursor read)
