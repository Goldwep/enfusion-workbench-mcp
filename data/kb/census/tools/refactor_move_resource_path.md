# Tool: refactor_move_resource_path

Rename/move a resource file on disk and update every `{GUID}<oldPath>` reference across the project to point at the new path.

Row: mcp:tool/refactor_move_resource_path. Tier T2/T5.

## Actions (1)

| action | risk | what |
| --- | --- | --- |
| run | mutating | Rename/move a resource file on disk and update every `{GUID}<oldPath>` reference across the project to point at the new path. |

## Rows linked to this tool (7)

- file:.conf (run read)
- file:.ent (run read)
- file:.et (run read)
- file:.gproj (run read)
- file:.layout (run read)
- file:.meta (run read)
- mcp:action/refactor_move_resource_path.run (run drive)
