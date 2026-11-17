# Tool: scenario_clone_area

Clone a rectangular world-coord area of a scenario layer file (.conf / .et / .layer) into a new layer file, regenerating every embedded GUID so the clone won't collide with the source.

Row: mcp:tool/scenario_clone_area. Tier T2/T5.

## Actions (1)

| action | risk | what |
| --- | --- | --- |
| run | mutating | Clone a rectangular world-coord area of a scenario layer file (.conf / .et / .layer) into a new layer file, regenerating every embedded GUID so the clone won't collide with the source. |

## Rows linked to this tool (4)

- file:.conf (run read)
- file:.ent (run read)
- file:.layer (run read)
- mcp:action/scenario_clone_area.run (run drive)
