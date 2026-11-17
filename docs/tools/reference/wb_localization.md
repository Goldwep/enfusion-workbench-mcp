# wb_localization

```text
Localization Editor: the open .st table.
Read:
status: Table, class, count
columns: Fields: name|type|enums
list: Item rows, paged
get: One item, all fields
selection: Selected/filtered rows
Mutating:
open: Open a .st
insert: Add an item
set: Set item fields
delete: Delete, return snapshot
filter: Column user filter
save: Save (confirm)
buildRuntime: Build runtime table
close: Close (confirm)
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Handler contract | `contracts/EMCP_WB_Localization.json` (EMCP_WB_Localization) |
| Census KB page | [data/kb/census/tools/wb_localization.md](../../../data/kb/census/tools/wb_localization.md) |

## Actions (13)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `status` | no | no | Table, class, count | none |
| `columns` | no | no | Fields: name\|type\|enums | none |
| `list` | no | no | Item rows, paged | `fields` (array<string>), `prefix` (string), `cursor` (string), `limit` (int) |
| `get` | no | no | One item, all fields | `id` (string), `index` (int) |
| `selection` | no | no | Selected/filtered rows | none |
| `open` | yes | no | Open a .st Refuses: MODAL_HAZARD while another table is open with handler edits not saved, or one opened by hand (no dirty-flag call) | `path`* (string) |
| `insert` | yes | no | Add an item Refuses: DUPLICATE_ID when the Id exists; MODAL_HAZARD per OnChange plugin rules | `id`* (string), `fields` (array<string>), `values` (array<string>) |
| `set` | yes | no | Set item fields Refuses: MODAL_HAZARD when an OnChange plugin would open a dialog for this edit | `id` (string), `index` (int), `fields`* (array<string>), `values`* (array<string>) |
| `delete` | yes | no | Delete, return snapshot Refuses: DUPLICATE_ID when two items share the Id (DeleteItem takes an Id) | `id` (string), `index` (int) |
| `filter` | yes | no | Column user filter | `column`* (string), `filter`* (string) |
| `save` | yes | yes | Save (confirm) Refuses: NO_DOCUMENT unless the table was opened through open; NOT_IN_PROJECT for a file outside the project | `confirm` (bool) |
| `buildRuntime` | yes | yes | Build runtime table Refuses: GATED until P-W3-18 passes | `confirm` (bool) |
| `close` | yes | no | Close (confirm) Refuses: GATED until P-W3-19 passes | `confirm` (bool) |

`*` marks a required parameter of that action.

## Input parameters (15)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | 1.x names still accepted: getTable, listLanguages, modify One of: `status`, `columns`, `list`, `get`, `selection`, `open`, `insert`, `set`, `delete`, `filter`, `save`, `buildRuntime`, `close`, `getTable`, `listLanguages`, `modify`. |
| `fields` | array<string> | no | default Id, Target_en_us |
| `prefix` | string | no | Id prefix filter |
| `cursor` | string | no | <start>:<count> |
| `limit` | integer | no | default 50, max 200 |
| `id` | string | no | item Id; or index |
| `index` | integer | no | Items index |
| `path` | string | no | clean relative .st path |
| `values` | array<string> | no | encoded values, same order |
| `column` | string | no | field name |
| `filter` | string | no | text the column contains |
| `confirm` | boolean | no | true saves, else a dry run |
| `itemId` | string | no | 1.x insert/delete/modify: the item Id (now id) |
| `property` | string | no | 1.x modify: the field to set (now fields) |
| `value` | string | no | 1.x insert/modify: the value (now values) |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_localization.<action>`. A row that links several actions is counted under each (65 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `buildRuntime` | 2 | T2 1, T3 1 | `mcp:action/wb_localization.buildRuntime`, `mcp:handler-action/EMCP_WB_Localization.buildRuntime` |
| `close` | 2 | T2 1, T3 1 | `mcp:action/wb_localization.close`, `mcp:handler-action/EMCP_WB_Localization.close` |
| `columns` | 3 | T5 3 | `api:LocalizationEditor.GetTable/0`, `mcp:action/wb_localization.columns`, `mcp:handler-action/EMCP_WB_Localization.columns` |
| `delete` | 6 | T2 1, T5 5 | `api:LocalizationEditor.BeginModify/1`, `api:LocalizationEditor.DeleteItem/1`, `api:LocalizationEditor.EndModify/0` |
| `filter` | 5 | T3 2, T5 3 | `api:LocalizationEditor.AddUserFilter/2`, `api:LocalizationEditor.GetTable/0`, `api:LocalizationEditor.RefreshUI/0` |
| `get` | 3 | T5 3 | `api:LocalizationEditor.GetTable/0`, `mcp:action/wb_localization.get`, `mcp:handler-action/EMCP_WB_Localization.get` |
| `getTable` | 3 | T0 1, T5 2 | `api:LocalizationEditor.GetTable/0`, `mcp:action/wb_localization.getTable`, `mcp:handler-action/EMCP_WB_Localization.getTable` |
| `insert` | 8 | T2 1, T5 7 | `api:LocalizationEditor.BeginModify/1`, `api:LocalizationEditor.DeleteItem/1`, `api:LocalizationEditor.EndModify/0` |
| `list` | 3 | T5 3 | `api:LocalizationEditor.GetTable/0`, `mcp:action/wb_localization.list`, `mcp:handler-action/EMCP_WB_Localization.list` |
| `listLanguages` | 3 | T0 1, T5 2 | `api:LocalizationEditor.GetTable/0`, `mcp:action/wb_localization.listLanguages`, `mcp:handler-action/EMCP_WB_Localization.listLanguages` |
| `modify` | 6 | T0 1, T5 5 | `api:LocalizationEditor.BeginModify/1`, `api:LocalizationEditor.EndModify/0`, `api:LocalizationEditor.GetTable/0` |
| `open` | 4 | T1 1, T5 3 | `api:LocalizationEditor.GetTable/0`, `mcp:action/wb_localization.open`, `mcp:handler-action/EMCP_WB_Localization.open` |
| `save` | 3 | T5 3 | `api:LocalizationEditor.GetTable/0`, `mcp:action/wb_localization.save`, `mcp:handler-action/EMCP_WB_Localization.save` |
| `selection` | 5 | T3 2, T5 3 | `api:LocalizationEditor.GetFilteredRows/1`, `api:LocalizationEditor.GetSelectedRows/1`, `api:LocalizationEditor.GetTable/0` |
| `set` | 6 | T5 6 | `api:LocalizationEditor.BeginModify/1`, `api:LocalizationEditor.EndModify/0`, `api:LocalizationEditor.GetTable/0` |
| `status` | 3 | T5 3 | `api:LocalizationEditor.GetTable/0`, `mcp:action/wb_localization.status`, `mcp:handler-action/EMCP_WB_Localization.status` |
