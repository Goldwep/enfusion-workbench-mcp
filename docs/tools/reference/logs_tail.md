# logs_tail

```text
Show the last N lines of a log channel from a session. Defaults to the newest Workbench session's console.log — the fastest path from 'something broke' to engine output. Use `which`/`session`/`channel` to override.
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Census KB page | [data/kb/census/tools/logs_tail.md](../../../data/kb/census/tools/logs_tail.md) |

## Input parameters (4)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `which` | string | no | Which logs root to use One of: `workbench`, `game`. Default: `"workbench"`. |
| `session` | string | no | Session ref: 'latest', 'logs_YYYY-MM-DD_HH-MM-SS', or an absolute path Default: `"latest"`. |
| `channel` | string | no | Which channel to tail One of: `console`, `error`, `script`, `crash`. Default: `"console"`. |
| `lines` | number | no | Number of lines from the end (1-2000, default 50) Default: `50`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/logs_tail.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.log` |
