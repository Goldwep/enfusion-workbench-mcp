# world_validate_refs

```text
File-scoped variant of `find_broken_refs`. Reads a single `.ent` or `.layer` file, walks the parsed tree to extract every `{GUID}path` reference, and reports which GUIDs resolve against the project-index and which don't. Use for spot-checking one prefab/world before publish; use `find_broken_refs` for the index-wide sweep.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/world_validate_refs.md](../../../data/kb/census/tools/world_validate_refs.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `file_path` | string | yes | Path to the `.ent` or `.layer` file. Absolute, or relative to the MCP server's working directory. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/world_validate_refs.<action>`. A row that links several actions is counted under each (2 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 2 | T2 2 | `file:.ent`, `file:.layer` |
