# script_overrides

```text
Find every `modded class <name>` declaration in a project's `.c` files. With no `class_name` filter, lists every modded chain grouped by base. With a filter, lists only overrides of the specified class. Walks the project root directly (not the project-index, which doesn't track .c files). Use for refactor impact analysis: if you rename a vanilla class, this tells you which mods need to update.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/script_overrides.md](../../../data/kb/census/tools/script_overrides.md) |

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `project_root` | string | yes | Absolute path to the project to scan (typically a .gproj's directory) |
| `class_name` | string | no | Optional class-name filter. Returns only `modded class <class_name>` matches. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/script_overrides.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.c` |
