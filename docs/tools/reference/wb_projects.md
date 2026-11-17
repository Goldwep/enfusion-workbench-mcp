# wb_projects

```text
Query project information from the Workbench. List all loaded addon projects, or find which loaded addon contains an absolute path (locate; not verified live). open refuses: a running Workbench cannot switch project; use wb_launch gprojPath.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/wb_projects.md](../../../data/kb/census/tools/wb_projects.md) |

## Actions (3)

`list`, `locate`, `open`

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | Action: list (all loaded projects), locate (name + root path of the loaded addon that contains an absolute path), or open (refused; it says how to open a project: wb_launch) One of: `list`, `locate`, `open`. |
| `name` | string | no | For locate (required): an absolute file or folder path inside a loaded addon; Bohemia's LocateProject takes a path, not an addon name. For open: ignored |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_projects.<action>`. A row that links several actions is counted under each (6 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `list` | 2 | T2 1, T3 1 | `mcp:action/wb_projects.list`, `net:handler/GetLoadedProjects` |
| `locate` | 2 | T2 1, T3 1 | `mcp:action/wb_projects.locate`, `net:handler/LocateProject` |
| `open` | 2 | T2 1, T3 1 | `mcp:action/wb_projects.open`, `mcp:handler-action/EMCP_WB_EditorControl.openResource` |
