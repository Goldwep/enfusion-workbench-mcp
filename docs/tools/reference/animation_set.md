# animation_set

```text
Read, check and edit animation sets offline, byte-exact: .ast (groups, columns, animations) and .asi (template, slot-to-.anm mappings, parents, IK pose). Actions: read (paged), validate (slots the .ast lacks, unresolved .anm), addGroup, addColumn, addAnimation, map, unmap, create. Writes stay in the project, are a dry run unless confirm: true, keep a .bak; new files need wb_resources register.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/animation_set.md](../../../data/kb/census/tools/animation_set.md) |

## Actions (8)

`read`, `validate`, `addGroup`, `addColumn`, `addAnimation`, `map`, `unmap`, `create`

## Input parameters (18)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `read`, `validate`, `addGroup`, `addColumn`, `addAnimation`, `map`, `unmap`, `create`. |
| `path` | string | yes | The .ast or .asi: project-relative, absolute inside the project, or (read, validate) a game path. |
| `projectPath` | string | no | Addon root. Uses the configured project when omitted. |
| `confirm` | boolean | no | Write the change. Without it the call is a dry run. |
| `group` | string | no | addGroup/addColumn/addAnimation/map/unmap: group name; create .ast: first group. |
| `column` | string | no | addColumn/map/unmap: column name. |
| `animation` | string | no | addAnimation/map/unmap: animation name. |
| `columns` | array<string> | no | addGroup, create .ast: the group's columns. |
| `animations` | array<string> | no | addGroup, create .ast: the group's animations. |
| `slot` | string | no | map/unmap: Group.Column.Animation, instead of group, column and animation. |
| `resource` | string | no | map: the .anm, {GUID}path or a path with a known GUID. |
| `resourceGuid` | string | no | map/create: 16-hex GUID of resource or template when the path has none. |
| `template` | string | no | create .asi: the .ast it instances. |
| `parentTemplates` | array<string> | no | create .asi: parent .asi files. |
| `ikPose` | string | no | create .asi: the IK pose .anm. |
| `filter` | string | no | read .asi: keep slots that contain this text. |
| `cursor` | string | no | read, validate: cursor from the last page. |
| `limit` | integer | no | read, validate: items per page. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/animation_set.<action>`. A row that links several actions is counted under each (18 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `addAnimation` | 2 | T2 1, T3 1 | `file:.ast`, `mcp:action/animation_set.addAnimation` |
| `addColumn` | 2 | T2 1, T3 1 | `file:.ast`, `mcp:action/animation_set.addColumn` |
| `addGroup` | 2 | T2 1, T3 1 | `file:.ast`, `mcp:action/animation_set.addGroup` |
| `create` | 2 | T2 1, T5 1 | `file:.ast`, `mcp:action/animation_set.create` |
| `map` | 2 | T2 1, T5 1 | `file:.asi`, `mcp:action/animation_set.map` |
| `read` | 3 | T2 2, T5 1 | `file:.asi`, `file:.ast`, `mcp:action/animation_set.read` |
| `unmap` | 2 | T2 1, T3 1 | `file:.asi`, `mcp:action/animation_set.unmap` |
| `validate` | 3 | T2 2, T5 1 | `file:.asi`, `file:.ast`, `mcp:action/animation_set.validate` |
