# meta_file

```text
Offline .meta sidecar tool; edits existing metas only (new resources: wb_resources register). Actions: read (configurations, ancestors, properties), scan (paged list under folder), set/clear (key, per configuration, default PC; allPlatforms for all), setAncestor. path = the source file, not the .meta. Writes stay in the project; dry run unless confirm:true.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/meta_file.md](../../../data/kb/census/tools/meta_file.md) |

## Actions (5)

`read`, `scan`, `set`, `clear`, `setAncestor`

## Input parameters (14)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `read`, `scan`, `set`, `clear`, `setAncestor`. |
| `path` | string | no | The resource (source file), relative to the project. |
| `folder` | string | no | scan: folder under the project (default: all). |
| `ext` | string | no | scan: only resources with this extension. |
| `cursor` | string | no | scan: cursor from the previous page. |
| `limit` | integer | no | scan: page size. |
| `configuration` | string | no | Platform, such as PC (default) or PS5. |
| `allPlatforms` | boolean | no | Write every configuration. |
| `key` | string | no | set/clear: property name. |
| `value` | string \| number \| boolean \| array<string \| number \| boolean> | no | set: the value. |
| `quoted` | boolean | no | set: force quotes on or off. |
| `ancestor` | string \| null | no | setAncestor: "{GUID}path", a platform name, or null to remove. |
| `confirm` | boolean | no | true writes; otherwise a dry run. |
| `projectPath` | string | no | Addon root; the configured project when omitted. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/meta_file.<action>`. A row that links several actions is counted under each (10 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `clear` | 2 | T2 1, T5 1 | `file:.meta`, `mcp:action/meta_file.clear` |
| `read` | 2 | T2 1, T5 1 | `file:.meta`, `mcp:action/meta_file.read` |
| `scan` | 2 | T2 1, T5 1 | `file:.meta`, `mcp:action/meta_file.scan` |
| `set` | 2 | T2 1, T5 1 | `file:.meta`, `mcp:action/meta_file.set` |
| `setAncestor` | 2 | T2 1, T5 1 | `file:.meta`, `mcp:action/meta_file.setAncestor` |
