# script_lsp

```text
Read-only client of the Workbench language server (Script Editor LSP on 127.0.0.1, port LSP_Port, default 5776). Actions: status, diagnostics, hover, definition, implementation, completion, signature on a project .c (path; 0-based line and character; text = unsaved content, never written). GATED until probe P-W3-23 passes and ENFUSION_SCRIPT_LSP=1; LSP_OFF while the port is closed.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/script_lsp.md](../../../data/kb/census/tools/script_lsp.md) |

## Actions (7)

`status`, `diagnostics`, `hover`, `definition`, `implementation`, `completion`, `signature`

## Input parameters (7)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `status`, `diagnostics`, `hover`, `definition`, `implementation`, `completion`, `signature`. |
| `path` | string | no | Project-relative .c file (every action but status). |
| `text` | string | no | The document's unsaved content, sent in memory; the file is never written. |
| `line` | integer | no | 0-based line (position actions). |
| `character` | integer | no | 0-based character in the line (position actions). |
| `cursor` | string | no | diagnostics/completion paging: the nextCursor an earlier answer gave. |
| `limit` | integer | no | Rows per page (default 100). |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/script_lsp.<action>`. A row that links several actions is counted under each (14 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `completion` | 2 | T0 1, T3 1 | `mcp:action/script_lsp.completion`, `net:net-function/LSP completion` |
| `definition` | 2 | T0 1, T3 1 | `mcp:action/script_lsp.definition`, `net:net-function/LSP go to definition %2F type definition %2F implementation` |
| `diagnostics` | 2 | T0 1, T3 1 | `mcp:action/script_lsp.diagnostics`, `net:net-function/LSP diagnostics` |
| `hover` | 2 | T0 1, T3 1 | `mcp:action/script_lsp.hover`, `net:net-function/LSP hover` |
| `implementation` | 2 | T0 1, T3 1 | `mcp:action/script_lsp.implementation`, `net:net-function/LSP go to definition %2F type definition %2F implementation` |
| `signature` | 2 | T0 1, T3 1 | `mcp:action/script_lsp.signature`, `net:net-function/LSP signature help` |
| `status` | 2 | T0 1, T3 1 | `mcp:action/script_lsp.status`, `net:net-function/LSP server` |
