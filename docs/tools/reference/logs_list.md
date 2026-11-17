# logs_list

```text
List Workbench (or game) log session directories newest-first. Each entry shows the channels present (console/error/script/crash) and the total session size. Sessions with a CRASH marker include a crash.log — likely worth `logs_tail` first. Use to answer 'what was the last session?' or 'do I have a crash to investigate?'
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/logs_list.md](../../../data/kb/census/tools/logs_list.md) |

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `which` | string | no | Which logs root to list (default workbench) One of: `workbench`, `game`. Default: `"workbench"`. |
| `limit` | number | no | Max sessions to show (1-100, default 20) Default: `20`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/logs_list.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.log` |
