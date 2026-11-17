# resolve_guid

```text
Look up a resource by its 16-hex-character GUID and return the defining file path, root type, class name, and inheritance clause. Useful when you have a GUID from a property value or inheritance line (e.g. `{A9806AF617972E97}path/to/file.et`) and need to know what defines it. Accepts the GUID with or without curly braces, case-insensitive. Returns a soft-fail message (not an error) when the GUID is not in the project-index — the resource may live in a project not yet indexed.
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Census KB page | [data/kb/census/tools/resolve_guid.md](../../../data/kb/census/tools/resolve_guid.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `guid` | string | yes | 16-character hex GUID, with or without curly braces (e.g., 'A9806AF617972E97' or '{A9806AF617972E97}') |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/resolve_guid.<action>`. A row that links several actions is counted under each (9 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 9 | T2 9 | `file:.conf`, `file:.emat`, `file:.ent` |
