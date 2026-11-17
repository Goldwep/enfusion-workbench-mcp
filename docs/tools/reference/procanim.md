# procanim

```text
Read, check and edit procedural animation files (.pap, .siga) offline. Actions: inspect (nodes, links, signals, compiled blocks), validate (dangling links, signals missing from the .siga, stale compiled blocks), nodes (node classes), edit (ops by node id), create (empty or copy). Writes: project only, dry run unless confirm: true; compiled blocks stay stale until saved in the ProcAnim Editor.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/procanim.md](../../../data/kb/census/tools/procanim.md) |

## Actions (5)

`inspect`, `validate`, `nodes`, `edit`, `create`

## Input parameters (11)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `inspect`, `validate`, `nodes`, `edit`, `create`. |
| `path` | string | no | The .pap or .siga: project-relative, absolute inside the project, or (inspect, validate) a game path. Not used by nodes. |
| `projectPath` | string | no | Addon root. Uses the configured project when omitted. |
| `confirm` | boolean | no | edit, create: write the change. Without it the call is a dry run. |
| `overwrite` | boolean | no | create: replace an existing file. |
| `query` | string | no | inspect: nodes whose class or name has this text. nodes: class text, pap, siga or a role. |
| `ops` | array<object> | no | edit: operations in order, all or none. op is one of set_property, remove_property, rename_node, move_node, set_model, add_node, remove_node, connect, disconnect; a node is its id or a unique name. set_property {node,key,value}, remove_property {node,key}, rename_node {node,name}, move_node {node,x,y}, set_model {model} (.pap), add_node {class,name?,props?,x?,y?}, remove_node {node}, connect/disconnect {from,to,port?} (.siga). |
| `source` | string | no | create: copy this .pap or .siga (project or game path) instead of an empty file. |
| `model` | string | no | create (.pap, empty): the model resource, {GUID}path.xob. |
| `cursor` | string | no | inspect, validate, nodes: cursor from the last page. |
| `limit` | integer | no | Items per page. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/procanim.<action>`. A row that links several actions is counted under each (10 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `create` | 2 | T2 1, T5 1 | `file:.pap`, `mcp:action/procanim.create` |
| `edit` | 2 | T2 1, T3 1 | `file:.pap`, `mcp:action/procanim.edit` |
| `inspect` | 2 | T2 1, T5 1 | `file:.pap`, `mcp:action/procanim.inspect` |
| `nodes` | 2 | T2 1, T5 1 | `file:.pap`, `mcp:action/procanim.nodes` |
| `validate` | 2 | T2 1, T5 1 | `file:.pap`, `mcp:action/procanim.validate` |
