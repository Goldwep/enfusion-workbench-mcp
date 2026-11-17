# wb_menu

```text
Workbench menu items from the census ledger. list and describe page them (read only): path, risk, verified, allowListed, opensDialog. run presses one via ExecuteAction, only if on the allow-list; a dialog or risk item refuses, a mutating one is a dry run unless confirm: true. The module must be open.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/wb_menu.md](../../../data/kb/census/tools/wb_menu.md) |

## Actions (3)

`list`, `describe`, `run`

## Input parameters (6)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `list`, `describe`, `run`. |
| `module` | string | no | list: filter; describe and run: required One of: `AnimEditor`, `AudioEditor`, `BehaviorEditor`, `LocalizationEditor`, `ParticleEditor`, `ProcAnimEditor`, `ResourceManager`, `ScriptEditor`, `WorldEditor`. |
| `path` | string | no | describe, run: comma-separated menu path |
| `cursor` | string | no | list: nextCursor |
| `limit` | integer | no | list: default 100 |
| `confirm` | boolean | no | run: press a mutating item; else a dry run |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_menu.<action>`. A row that links several actions is counted under each (19 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `describe` | 1 | T3 1 | `mcp:action/wb_menu.describe` |
| `list` | 1 | T3 1 | `mcp:action/wb_menu.list` |
| `run` | 17 | T2 1, T3 5, T5 11 | `mcp:handler-action/EMCP_WB_ExecuteAction.run`, `ui:WorldEditor/menu-item/Edit/Undo`, `ui:WorldEditor/menu-item/Entities/Focus Selection` |
