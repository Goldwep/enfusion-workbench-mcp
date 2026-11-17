# wb_diag

```text
Diag Menu options by script id (read, runtime set, select) and Workbench environment reads.
Read:
catalog: (TS) menus and options: path, enum name, kind
get: Option values by enum name
info: User, cwd, exe, project, UTC time, command line
Mutating:
set: One allow-listed option, runtime; previous and read-back
select: Show a menu page by name or id
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Handler contract | `contracts/EMCP_WB_Diag.json` (EMCP_WB_Diag) |
| Census KB page | [data/kb/census/tools/wb_diag.md](../../../data/kb/census/tools/wb_diag.md) |

## Actions (5)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `catalog` | no | no | (TS) menus and options: path, enum name, kind Refuses: Served by the TS tool from the census diag rows and the DiagMenu registration calls in the pak scripts; the handler refuses it INVALID_ARGUMENT. | `menu` (string), `cursor` (string), `limit` (int) |
| `get` | no | no | Option values by enum name Refuses: DIAG_UNKNOWN when no name is an enum value; INVALID_ARGUMENT; UNPROVEN for range until P-W8-07 and engine kinds until P-W8-08 | `names`* (array<string>), `kinds` (array<string>) |
| `info` | no | no | User, cwd, exe, project, UTC time, command line Refuses: MODULE_NOT_OPEN; INVALID_ARGUMENT for an unknown module or a bad cmdNames entry | `module` (string), `cmdNames` (array<string>) |
| `set` | yes | no | One allow-listed option, runtime; previous and read-back Refuses: DIAG_UNKNOWN; INVALID_ARGUMENT; UNPROVEN for range until P-W8-07 and engine kinds until P-W8-08; the allow-list is checked by the TS tool | `name`* (string), `kind` (string), `value`* (string) |
| `select` | yes | no | Show a menu page by name or id Refuses: WRONG_MODE outside play mode; DIAG_UNKNOWN for a menuId that is no SCR_DebugMenuID value; INVALID_ARGUMENT | `menu` (string), `menuId` (int) |

`*` marks a required parameter of that action.

## Input parameters (12)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `catalog`, `get`, `info`, `set`, `select`. |
| `menu` | string | no | menu path prefix, e.g. AI/AIScript |
| `cursor` | string | no | nextCursor of a page |
| `limit` | integer | no | rows per page, max 200 |
| `names` | array<string> | no | SCR_DebugMenuID or EDiagMenu names |
| `kinds` | array<string> | no | bool\|value\|range\|engine\|engineRange |
| `module` | string | no | module of cmdNames; default WorldEditor |
| `cmdNames` | array<string> | no | GetCmdLine names, max 20 |
| `name` | string | no | enum name |
| `kind` | string | no | bool\|value\|range\|engine\|engineRange |
| `value` | string | no | int, 0/1 or float as text |
| `menuId` | integer | no | SCR_DebugMenuID value |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_diag.<action>`. A row that links several actions is counted under each (192 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `catalog` | 2 | T3 2 | `mcp:action/wb_diag.catalog`, `mcp:handler-action/EMCP_WB_Diag.catalog` |
| `get` | 150 | T3 150 | `diag:AI/AIScript/AI Debug Category`, `diag:AI/AIScript/Debug cover search`, `diag:AI/AIScript/Open Debug Panel` |
| `info` | 16 | T3 14, T5 2 | `api:DateTimeUtcAsInt.GetDay/0`, `api:DateTimeUtcAsInt.GetHour/0`, `api:DateTimeUtcAsInt.GetMinute/0` |
| `select` | 22 | T3 22 | `diag:AI/AIScript`, `diag:Conflict`, `diag:Conflict/Military Supply Allocation` |
| `set` | 2 | T3 2 | `mcp:action/wb_diag.set`, `mcp:handler-action/EMCP_WB_Diag.set` |
