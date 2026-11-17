# animation_workspace

```text
Read and edit animation workspaces (.aw) offline, byte-exact. read, files (paged: graph, sheets, set, instances, tables, models), validate (paged). duplicate copies the whole set into the project, registers each copy and rewrites every internal GUID (dry run lists the map); set changes one link; create makes a workspace and an empty .ae. Writes stay in the project and need confirm.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/animation_workspace.md](../../../data/kb/census/tools/animation_workspace.md) |

## Actions (6)

`read`, `files`, `validate`, `duplicate`, `set`, `create`

## Input parameters (17)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `read`, `files`, `validate`, `duplicate`, `set`, `create`. |
| `path` | string | no | The .aw: project-relative, {GUID}path, absolute inside the project, or a game path (not for set or create). |
| `projectPath` | string | no | Addon root. Uses the configured project when omitted. |
| `target` | string | no | duplicate/create: the new .aw, project-relative. |
| `confirm` | boolean | no | duplicate/set/create: write. Without it the call is a dry run. |
| `field` | string | no | set: the link to change. One of: `AnimGraph`, `AnimSetTemplate`, `AnimSetInstances`, `Model`, `ExpressionTable`, `SyncTable`, `ProjectFile`. |
| `value` | string | no | set: {GUID}path, or a project path that has a .meta. |
| `values` | array<string> | no | set AnimSetInstances: the whole list. |
| `index` | integer | no | set Model: preview model (the next free index adds one); ProjectFile: audio project (default 0). |
| `animSetTemplate` | string | no | create: the .ast link. |
| `animGraph` | string | no | create: the .agr link. |
| `animSetInstances` | array<string> | no | create: .asi links. |
| `model` | string | no | create: the preview .xob. |
| `eventTable` | string | no | create: the new .ae path (default beside the .aw). |
| `skipEventTable` | boolean | no | create: write no .ae. |
| `cursor` | string | no | files/validate: cursor from the last page. |
| `limit` | integer | no | files/validate: rows per page. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/animation_workspace.<action>`. A row that links several actions is counted under each (12 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `create` | 2 | T2 1, T5 1 | `file:.aw`, `mcp:action/animation_workspace.create` |
| `duplicate` | 2 | T2 1, T3 1 | `file:.aw`, `mcp:action/animation_workspace.duplicate` |
| `files` | 2 | T2 1, T5 1 | `file:.aw`, `mcp:action/animation_workspace.files` |
| `read` | 2 | T2 1, T5 1 | `file:.aw`, `mcp:action/animation_workspace.read` |
| `set` | 2 | T2 1, T5 1 | `file:.aw`, `mcp:action/animation_workspace.set` |
| `validate` | 2 | T2 1, T5 1 | `file:.aw`, `mcp:action/animation_workspace.validate` |
