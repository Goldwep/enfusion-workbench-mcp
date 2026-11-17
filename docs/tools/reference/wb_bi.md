# wb_bi

```text
Bohemia's own Workbench NET handlers. Read: list: the handlers with declared fields, class and live flag; describe: one handler; call: one of the 14 verified read-only handlers, request checked against its declared fields. Mutating: callMutating: gated until the Bohemia battery.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/wb_bi.md](../../../data/kb/census/tools/wb_bi.md) |

## Actions (4)

`list`, `describe`, `call`, `callMutating`

## Input parameters (3)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `list`, `describe`, `call`, `callMutating`. |
| `handler` | string | no | Bohemia handler name (list) |
| `request` | object | no | declared request fields only (describe) |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_bi.<action>`. A row that links several actions is counted under each (89 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `call` | 20 | T2 14, T3 6 | `mcp:action/wb_bi.call`, `net:handler/AnimExportProfileChannels`, `net:handler/AnimExportProfiles` |
| `callMutating` | 1 | T3 1 | `mcp:action/wb_bi.callMutating` |
| `describe` | 34 | T2 33, T3 1 | `mcp:action/wb_bi.describe`, `net:handler/AnimExportProfileChannels`, `net:handler/AnimExportProfiles` |
| `list` | 34 | T2 33, T3 1 | `mcp:action/wb_bi.list`, `net:handler/AnimExportProfileChannels`, `net:handler/AnimExportProfiles` |
