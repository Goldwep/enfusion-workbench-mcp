# wb_settings

```text
Workbench settings store. Read: stores, list, get, diff, shortcuts, options (the registry key, read-only; scratch ini files). Write only to a scratch ini this tool made: profile (a scrubbed copy of the registry), set, unset (dry run unless confirm; refused while Workbench runs). Launch with it through wb_launch forceSettings. The registry is never written.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/wb_settings.md](../../../data/kb/census/tools/wb_settings.md) |

## Actions (9)

`stores`, `list`, `get`, `diff`, `shortcuts`, `options`, `profile`, `set`, `unset`

## Input parameters (13)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `stores`, `list`, `get`, `diff`, `shortcuts`, `options`, `profile`, `set`, `unset`. |
| `store` | string | no | list/get: registry (default) or a scratch ini |
| `a` | string | no | diff |
| `b` | string | no | diff |
| `section` | string | no | ini section, e.g. World%20Editor |
| `key` | string | no | ini key |
| `value` | string | no | set |
| `path` | string | no | set/unset: the scratch ini |
| `name` | string | no | new scratch ini name (set/unset: default <name>-<n>) |
| `page` | string | no | options |
| `cursor` | string | no | nextCursor |
| `limit` | integer | no | Items per page. |
| `confirm` | boolean | no | write; else a dry run |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_settings.<action>`. A row that links several actions is counted under each (16 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `diff` | 2 | T2 1, T5 1 | `file:.ini`, `mcp:action/wb_settings.diff` |
| `get` | 2 | T2 1, T5 1 | `file:.ini`, `mcp:action/wb_settings.get` |
| `list` | 2 | T2 1, T5 1 | `file:.ini`, `mcp:action/wb_settings.list` |
| `options` | 1 | T3 1 | `mcp:action/wb_settings.options` |
| `profile` | 2 | T2 1, T3 1 | `file:.ini`, `mcp:action/wb_settings.profile` |
| `set` | 2 | T2 1, T3 1 | `file:.ini`, `mcp:action/wb_settings.set` |
| `shortcuts` | 1 | T3 1 | `mcp:action/wb_settings.shortcuts` |
| `stores` | 2 | T2 1, T5 1 | `file:.ini`, `mcp:action/wb_settings.stores` |
| `unset` | 2 | T2 1, T3 1 | `file:.ini`, `mcp:action/wb_settings.unset` |
