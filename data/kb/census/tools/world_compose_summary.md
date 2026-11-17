# Tool: world_compose_summary

Produce a static markdown summary of a `.ent` world file — total entity count, top entity classes by count, SubScene parent references (worlds that wrap another world via `SubScene { Parent "{GUID}path" }`), sibling `*_Layers/*.layer` file count, and a best-effort XYZ bounding box from any positional properties found.

Row: mcp:tool/world_compose_summary. Tier T2/T5.

## Actions (1)

| action | risk | what |
| --- | --- | --- |
| run | mutating | Produce a static markdown summary of a `.ent` world file — total entity count, top entity classes by count, SubScene parent references (worlds that wrap another world via `SubScene { Parent "{GUID}path" }`), sibling `*_Layers/*.layer` file count, and a best-effort XYZ bounding box from any positional properties found. |

## Rows linked to this tool (2)

- file:.ent (run read)
- file:.layer (run read)
