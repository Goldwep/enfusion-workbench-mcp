# Tool: wb_build_data

Build packed .pak data for a project: -wbModule=ResourceManager -buildData <platform> <outDir> -gproj <gproj> (unresolved: the -buildData plus -gproj form is unmeasured, DEC-047 L7).

Row: mcp:tool/wb_build_data. Tier T2/T2.

## Actions (3)

| action | risk | what |
| --- | --- | --- |
| poll | mutating | report the status/result of a job_id |
| run | mutating | build synchronously and report |
| start | mutating | launch the build as a background job and return its job_id at once |

## Rows linked to this tool (5)

- cli:-builddata (poll read, run drive, start drive)
- cli:-gproj (poll read, run drive, start drive)
- cli:-wbmodule (poll read, run drive, start drive)
- mcp:action/wb_build_data.poll (poll drive)
- mcp:action/wb_build_data.start (start drive)
