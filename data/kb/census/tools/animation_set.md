# Tool: animation_set

Read, check and edit animation sets offline, byte-exact: .ast (groups, columns, animations) and .asi (template, slot-to-.anm mappings, parents, IK pose).

Row: mcp:tool/animation_set. Tier T2/T2.

## Actions (8)

| action | risk | what |
| --- | --- | --- |
| addAnimation | mutating | mcp action 'animation_set.addAnimation' in none under animation_set |
| addColumn | mutating | mcp action 'animation_set.addColumn' in none under animation_set |
| addGroup | mutating | mcp action 'animation_set.addGroup' in none under animation_set |
| create | mutating | mcp action 'animation_set.create' in none under animation_set |
| map | mutating | mcp action 'animation_set.map' in none under animation_set |
| read | safe | mcp action 'animation_set.read' in none under animation_set |
| unmap | mutating | mcp action 'animation_set.unmap' in none under animation_set |
| validate | mutating | mcp action 'animation_set.validate' in none under animation_set |

## Rows linked to this tool (10)

- file:.asi (map drive, read read, unmap drive, validate read)
- file:.ast (addAnimation drive, addColumn drive, addGroup drive, create drive, read read, validate read)
- mcp:action/animation_set.addAnimation (addAnimation drive)
- mcp:action/animation_set.addColumn (addColumn drive)
- mcp:action/animation_set.addGroup (addGroup drive)
- mcp:action/animation_set.create (create drive)
- mcp:action/animation_set.map (map drive)
- mcp:action/animation_set.read (read drive)
- mcp:action/animation_set.unmap (unmap drive)
- mcp:action/animation_set.validate (validate drive)
