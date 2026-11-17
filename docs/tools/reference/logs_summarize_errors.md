# logs_summarize_errors

```text
Group warnings and errors in a log channel into signature buckets and report counts, first-seen line, and a sample. Cuts a 50,000-line log into ~20 lines of 'here's what broke and how often'. Use as your first call after a suspect build — `logs_tail` only shows the latest, this shows the SHAPE of the problems.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/logs_summarize_errors.md](../../../data/kb/census/tools/logs_summarize_errors.md) |

## Input parameters (4)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `which` | string | no | Logs root One of: `workbench`, `game`. Default: `"workbench"`. |
| `session` | string | no | Session ref: 'latest', name, or absolute path Default: `"latest"`. |
| `channel` | string | no | Which channel to scan (default error.log) One of: `console`, `error`, `script`, `crash`. Default: `"error"`. |
| `top_n` | number | no | How many top groups to display (1-100, default 15) Default: `15`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/logs_summarize_errors.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.log` |
