# behavior_tree

```text
Read, check, author, edit and compare AI behavior trees (.bt) as files, offline. Actions: inspect, validate, nodes (the build's Node and test classes, with vanilla usage), create (spec), edit (ops on a project tree), diff (path against other: nodes added, removed, moved, changed; paged). Writes stay in the project. Spec, op and node-path grammar: wb_knowledge "behavior tree".
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/behavior_tree.md](../../../data/kb/census/tools/behavior_tree.md) |

## Actions (6)

`inspect`, `validate`, `nodes`, `create`, `edit`, `diff`

## Input parameters (12)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `inspect`, `validate`, `nodes`, `create`, `edit`, `diff`. |
| `path` | string | no | inspect/validate/edit/diff: absolute path, path under the project, or game resource path (read only). |
| `other` | string | no | diff: the second tree (after), as path. |
| `type` | string | no | nodes: one class, in full. |
| `query` | string | no | nodes: substring of the class name. |
| `spec` | object | no | create: {path, guid?, variables?, root: node}. |
| `ops` | array<object> | no | edit: operations, applied in order; all or nothing. |
| `overwrite` | boolean | no | create: replace an existing file (default false). |
| `dry_run` | boolean | no | create/edit: return the text without writing. |
| `cursor` | string | no | diff: nextCursor of the previous page. |
| `limit` | integer | no | diff: changes per page (default 100). |
| `projectPath` | string | no | Addon root. Uses the configured project when omitted. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/behavior_tree.<action>`. A row that links several actions is counted under each (12 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `create` | 2 | T2 1, T3 1 | `file:.bt`, `mcp:action/behavior_tree.create` |
| `diff` | 2 | T2 1, T3 1 | `file:.bt`, `mcp:action/behavior_tree.diff` |
| `edit` | 2 | T2 1, T3 1 | `file:.bt`, `mcp:action/behavior_tree.edit` |
| `inspect` | 2 | T2 1, T3 1 | `file:.bt`, `mcp:action/behavior_tree.inspect` |
| `nodes` | 2 | T2 1, T3 1 | `file:.bt`, `mcp:action/behavior_tree.nodes` |
| `validate` | 2 | T2 1, T3 1 | `file:.bt`, `mcp:action/behavior_tree.validate` |
