# wb_census

```text
Query the census ledger: what a Workbench or game surface is and where it lives. find: by name or id (filters dim, kind, module, tier). describe: one row by id. status: build and counts. howto (query: a task, row id or tool name): tool, action, tier, path, safety. scanProject walks a project folder (path) offline. Read-only, never contacts Workbench.
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Census KB page | [data/kb/census/tools/wb_census.md](../../../data/kb/census/tools/wb_census.md) |

## Actions (5)

`find`, `describe`, `howto`, `status`, `scanProject`

## Input parameters (9)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | find, describe, howto, status or scanProject One of: `find`, `describe`, `howto`, `status`, `scanProject`. |
| `path` | string | no | scanProject: project folder to walk |
| `query` | string | no | find: name, id or keyword |
| `id` | string | no | describe: row id, e.g. api:WorldEditorAPI |
| `dim` | string | no | filter: dimension, e.g. api, ui, mcp |
| `kind` | string | no | filter: row kind, e.g. class, method, menu-item |
| `module` | string | no | filter: module, e.g. WorldEditor |
| `tier` | string | no | find filter: exact tier T0 to T5 |
| `limit` | integer | no | find: maximum rows returned Default: `20`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_census.<action>`. A row that links several actions is counted under each (5 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `describe` | 1 | T3 1 | `mcp:action/wb_census.describe` |
| `find` | 1 | T3 1 | `mcp:action/wb_census.find` |
| `howto` | 1 | T3 1 | `mcp:action/wb_census.howto` |
| `scanProject` | 1 | T3 1 | `mcp:action/wb_census.scanProject` |
| `status` | 1 | T3 1 | `mcp:action/wb_census.status` |
