# string_table

```text
Offline string tables as files: .st (StringTable/Items) and runtime .conf (Ids/Texts). Read: inspect, get, lint, lookup (base-game Language/*.conf, 13 languages). Write, project only, dry run unless confirm:true: create, upsert, remove, buildRuntime (<name>.<lang>.conf, SCR_LocExportPlugin rules). Refuses files it cannot rewrite byte-exact.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/string_table.md](../../../data/kb/census/tools/string_table.md) |

## Actions (8)

`inspect`, `get`, `lint`, `lookup`, `create`, `upsert`, `remove`, `buildRuntime`

## Input parameters (14)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `inspect`, `get`, `lint`, `lookup`, `create`, `upsert`, `remove`, `buildRuntime`. |
| `path` | string | no | A .st or runtime .conf: project-relative, or a game resource path (read only). lookup: a runtime table (default Language/localization.en_us.conf). |
| `prefix` | string | no | get/lookup: Ids that start with this. |
| `ids` | array<string> | no | get/lookup: exact Ids. remove: the Ids to remove. |
| `fields` | string | no | get (.st): comma list of columns, or *. Default Id,Target_en_us. |
| `cursor` | string | no | Paging: the next value an earlier reply gave. |
| `limit` | integer | no | Rows per page (default 100). |
| `languages` | array<string> | no | lookup/buildRuntime: language codes such as en_us. |
| `items` | array<object> | no | create/upsert: [{Id, Target_en_us, Status, ...}]; null removes a field on upsert. |
| `itemClass` | string | no | create/upsert: item class (default CustomStringTableItem). |
| `outDir` | string | no | buildRuntime: project folder for the .conf files (default: the .st's folder). |
| `overwrite` | boolean | no | create/buildRuntime: replace existing files. |
| `confirm` | boolean | no | Write. Without it a write action only answers the change. |
| `projectPath` | string | no | Addon root. Uses the configured project when omitted. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/string_table.<action>`. A row that links several actions is counted under each (16 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `buildRuntime` | 2 | T2 1, T5 1 | `file:.st`, `mcp:action/string_table.buildRuntime` |
| `create` | 2 | T2 1, T5 1 | `file:.st`, `mcp:action/string_table.create` |
| `get` | 2 | T2 1, T5 1 | `file:.st`, `mcp:action/string_table.get` |
| `inspect` | 2 | T2 1, T5 1 | `file:.st`, `mcp:action/string_table.inspect` |
| `lint` | 2 | T2 1, T5 1 | `file:.st`, `mcp:action/string_table.lint` |
| `lookup` | 2 | T2 1, T5 1 | `file:.st`, `mcp:action/string_table.lookup` |
| `remove` | 2 | T2 1, T5 1 | `file:.st`, `mcp:action/string_table.remove` |
| `upsert` | 2 | T2 1, T5 1 | `file:.st`, `mcp:action/string_table.upsert` |
