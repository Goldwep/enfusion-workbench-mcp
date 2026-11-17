# Tool: wb_projects

Query project information from the Workbench.

Row: mcp:tool/wb_projects. Tier T2/T2.

## Actions (3)

| action | risk | what |
| --- | --- | --- |
| list | safe | all loaded projects |
| locate | safe | name + root path of the loaded addon that contains an absolute path |
| open | mutating | refused; it says how to open a project: wb_launch |

## Rows linked to this tool (6)

- mcp:action/wb_projects.list (list drive)
- mcp:action/wb_projects.locate (locate drive)
- mcp:action/wb_projects.open (open drive)
- mcp:handler-action/EMCP_WB_EditorControl.openResource (open read)
- net:handler/GetLoadedProjects (list read)
- net:handler/LocateProject (locate read)
