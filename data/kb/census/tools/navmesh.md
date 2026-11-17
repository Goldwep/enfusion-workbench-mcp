# Tool: navmesh

Offline navmesh files of a world: status (AIWorld config, navmesh files config, .nmn header, .NavData tile count, size and age), header, tiles (paged), config, projects (.gproj navmesh projects), overrideConfig (project override of a vanilla Navmesh_*.conf, dry run unless confirm).

Row: mcp:tool/navmesh. Tier T2/T2.

## Actions (6)

| action | risk | what |
| --- | --- | --- |
| config | mutating | mcp action 'navmesh.config' in none under navmesh |
| header | mutating | mcp action 'navmesh.header' in none under navmesh |
| overrideConfig | mutating | mcp action 'navmesh.overrideConfig' in none under navmesh |
| projects | mutating | mcp action 'navmesh.projects' in none under navmesh |
| status | safe | mcp action 'navmesh.status' in none under navmesh |
| tiles | mutating | mcp action 'navmesh.tiles' in none under navmesh |

## Rows linked to this tool (10)

- file:.conf (config read, overrideConfig drive, status read)
- file:.gproj (projects read)
- file:.nmn (header read, status read, tiles read)
- file:.ntile (header read)
- mcp:action/navmesh.config (config drive)
- mcp:action/navmesh.header (header drive)
- mcp:action/navmesh.overrideConfig (overrideConfig drive)
- mcp:action/navmesh.projects (projects drive)
- mcp:action/navmesh.status (status drive)
- mcp:action/navmesh.tiles (tiles drive)
