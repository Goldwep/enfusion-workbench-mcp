# logs_filter

```text
Paginated view of log lines matching regex / level / category filters. Common idioms: `level=error` to see only errors, `pattern='obsolete'` to find deprecation hits, `category=SCRIPT` to focus on the script subsystem. Pair with `logs_tail` when you want the most recent context.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/logs_filter.md](../../../data/kb/census/tools/logs_filter.md) |

## Input parameters (8)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `which` | string | no | Logs root One of: `workbench`, `game`. Default: `"workbench"`. |
| `session` | string | no | Session ref: 'latest', name, or absolute path Default: `"latest"`. |
| `channel` | string | no | Which channel to scan One of: `console`, `error`, `script`, `crash`. Default: `"console"`. |
| `level` | string | no | Filter by parsed level One of: `info`, `warn`, `error`, `raw`, `any`. Default: `"any"`. |
| `category` | string | no | Filter by category (e.g. SCRIPT, ENGINE, RESOURCES). Case-sensitive. |
| `pattern` | string | no | Optional regex applied to the message body (JS regex syntax) |
| `limit` | number | no | Max matches per page (1-500, default 100) Default: `100`. |
| `cursor` | string | no | Opaque pagination token |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/logs_filter.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.log` |
