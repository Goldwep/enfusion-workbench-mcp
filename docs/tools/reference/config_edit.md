# config_edit

```text
Read and edit Enfusion text configs offline (.conf .emat .gamemat .physmat .vhcsurf .styles) through the lossless parser. Actions: read (outline, schema from the API index), set, clear, arrayAdd, arrayRemove, setAncestor, createInherited, override. Writes stay in the project and are a dry run unless confirm:true; a file it cannot reproduce byte for byte is refused.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/config_edit.md](../../../data/kb/census/tools/config_edit.md) |

## Actions (8)

`read`, `set`, `clear`, `arrayAdd`, `arrayRemove`, `setAncestor`, `createInherited`, `override`

## Input parameters (16)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `read`, `set`, `clear`, `arrayAdd`, `arrayRemove`, `setAncestor`, `createInherited`, `override`. |
| `path` | string | yes | Project-relative resource path (read, createInherited, override also take a game resource). |
| `property` | string | no | Path inside the file, as read lists it (Actions.Action[1].Type). arrayAdd/arrayRemove: the block ('' or omitted = the root block). |
| `value` | string \| number \| boolean \| array<any> | no | set: the new value; a list writes several on one line. |
| `quoted` | boolean | no | set: force quotes on or off (default: as the slot has). |
| `item` | any | no | arrayAdd: a scalar, {value}, {key,value} or an object {key, className?, name?, guid?, base?, entries?: [...]}. |
| `index` | integer | no | arrayAdd position (default end); arrayRemove entry. |
| `ancestor` | string | no | setAncestor, createInherited, override: {GUID}path. setAncestor: '' removes it. |
| `newPath` | string | no | createInherited: the new file, project-relative. |
| `values` | object | no | createInherited, override: {propertyPath: value} set in the new file. |
| `depth` | integer | no | read: outline depth (default 2). |
| `limit` | integer | no | read: entries (default 100). |
| `schema` | boolean | no | read: add the API-index schema (default true). |
| `confirm` | boolean | no | true writes; otherwise a dry run. |
| `overwrite` | boolean | no | createInherited, override: replace an existing file. |
| `projectPath` | string | no | Addon root. Uses the configured project when omitted. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/config_edit.<action>`. A row that links several actions is counted under each (16 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `arrayAdd` | 2 | T2 1, T5 1 | `file:.conf`, `mcp:action/config_edit.arrayAdd` |
| `arrayRemove` | 2 | T2 1, T5 1 | `file:.conf`, `mcp:action/config_edit.arrayRemove` |
| `clear` | 2 | T2 1, T5 1 | `file:.conf`, `mcp:action/config_edit.clear` |
| `createInherited` | 2 | T2 1, T5 1 | `file:.conf`, `mcp:action/config_edit.createInherited` |
| `override` | 2 | T2 1, T3 1 | `file:.conf`, `mcp:action/config_edit.override` |
| `read` | 2 | T2 1, T5 1 | `file:.conf`, `mcp:action/config_edit.read` |
| `set` | 2 | T2 1, T5 1 | `file:.conf`, `mcp:action/config_edit.set` |
| `setAncestor` | 2 | T2 1, T5 1 | `file:.conf`, `mcp:action/config_edit.setAncestor` |
