# Tool: project_validate

Run lint/validation against a target file under the requested scope.

Row: mcp:tool/project_validate. Tier T2/T2.

## Actions (3)

| action | risk | what |
| --- | --- | --- |
| faction | mutating | mcp action 'project_validate.faction' in none under project_validate |
| mod | mutating | mcp action 'project_validate.mod' in none under project_validate |
| scenario | mutating | mcp action 'project_validate.scenario' in none under project_validate |

## Rows linked to this tool (6)

- file:.conf (faction read, mod read, scenario read)
- file:.ent (scenario read)
- file:.gproj (faction read, mod read, scenario read)
- mcp:action/project_validate.faction (faction drive)
- mcp:action/project_validate.mod (mod drive)
- mcp:action/project_validate.scenario (scenario drive)
