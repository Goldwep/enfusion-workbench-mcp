# Tool: workshop_check_deps

Read a `.gproj` from disk, extract its Dependencies block, and resolve each dep GUID the way WORKBENCH does: against the Workbench addons dir, the folders next to the project, and the base game + Tools installs.

Row: mcp:tool/workshop_check_deps. Tier T2/T5.

## Actions (1)

| action | risk | what |
| --- | --- | --- |
| run | mutating | Read a `.gproj` from disk, extract its Dependencies block, and resolve each dep GUID the way WORKBENCH does: against the Workbench addons dir, the folders next to the project, and the base game + Tools installs. |

## Rows linked to this tool (1)

- file:.gproj (run read)
