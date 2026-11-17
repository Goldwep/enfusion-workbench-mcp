# world_compose_summary

```text
Produce a static markdown summary of a `.ent` world file — total entity count, top entity classes by count, SubScene parent references (worlds that wrap another world via `SubScene { Parent "{GUID}path" }`), sibling `*_Layers/*.layer` file count, and a best-effort XYZ bounding box from any positional properties found. This is a STATIC analysis — pure file parsing, no Workbench connection or project-index required. Accepts an absolute path or a path relative to the current working directory.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/world_compose_summary.md](../../../data/kb/census/tools/world_compose_summary.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `world_path` | string | yes | Path to a `.ent` world file. Absolute, or relative to the MCP server's working directory. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/world_compose_summary.<action>`. A row that links several actions is counted under each (2 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 2 | T2 2 | `file:.ent`, `file:.layer` |
