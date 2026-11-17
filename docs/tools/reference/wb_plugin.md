# wb_plugin

```text
Workbench plugins: catalog, presence, settings; runs reviewed dialog-free plugins.
Read:
list: Plugin catalog from the ledger (TS), paged
describe: Class present? GetPlugin instance? (module open)
getSettings: Read the plugin's variables, paged
Mutating:
setSettings: Set one [Attribute] variable; dry run unless confirm
run: Run() of an allow-listed plugin; else a precondition check
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Handler contract | `contracts/EMCP_WB_Plugin.json` (EMCP_WB_Plugin) |
| Census KB page | [data/kb/census/tools/wb_plugin.md](../../../data/kb/census/tools/wb_plugin.md) |

## Actions (5)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `list` | no | no | Plugin catalog from the ledger (TS), paged | `moduleName` (string), `cursor` (string), `limit` (int) |
| `describe` | no | no | Class present? GetPlugin instance? (module open) | `moduleName`* (string), `className`* (string) |
| `getSettings` | no | no | Read the plugin's variables, paged | `moduleName`* (string), `className`* (string), `cursor` (string), `limit` (int) |
| `setSettings` | yes | yes | Set one [Attribute] variable; dry run unless confirm Refuses: With confirm NO_SETTER until P-W6-03 (a registry write stays refused, OI-W6-1); NOT_ALLOWLISTED; NOT_IN_PROJECT; INVALID_ARGUMENT for bad types or values. | `moduleName`* (string), `className`* (string), `name`* (string), `value`* (string), `confirm` (bool) |
| `run` | yes | yes | Run() of an allow-listed plugin; else a precondition check Refuses: PLUGIN_MODAL (E03 modal); NOT_ALLOWLISTED; NOT_IN_PROJECT; PRECONDITION_UNMET; with confirm GATED per class until P-W6-05. RunCommandline, Configure never run. | `moduleName`* (string), `className`* (string), `confirm` (bool) |

`*` marks a required parameter of that action.

## Input parameters (8)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `list`, `describe`, `getSettings`, `setSettings`, `run`. |
| `moduleName` | string | no | filter by module |
| `cursor` | string | no | nextCursor of a page |
| `limit` | integer | no | rows per page, max 200 |
| `className` | string | no | plugin class |
| `name` | string | no | variable name |
| `value` | string | no | text; floats as text |
| `confirm` | boolean | no | true writes; else a dry run |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_plugin.<action>`. A row that links several actions is counted under each (14 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `describe` | 3 | T3 3 | `api:WBModuleDef.GetPlugin/1`, `mcp:action/wb_plugin.describe`, `mcp:handler-action/EMCP_WB_Plugin.describe` |
| `getSettings` | 2 | T3 2 | `mcp:action/wb_plugin.getSettings`, `mcp:handler-action/EMCP_WB_Plugin.getSettings` |
| `list` | 2 | T3 2 | `mcp:action/wb_plugin.list`, `mcp:handler-action/EMCP_WB_Plugin.list` |
| `run` | 5 | T2 3, T3 2 | `api:WorkbenchPlugin.Run/0`, `mcp:handler-action/EMCP_WB_Plugin.run`, `plugin:CameraOrientationTool` |
| `setSettings` | 2 | T3 2 | `mcp:action/wb_plugin.setSettings`, `mcp:handler-action/EMCP_WB_Plugin.setSettings` |
