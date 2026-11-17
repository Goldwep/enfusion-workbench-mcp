# list_dependencies

```text
List the `Dependencies { ... }` entries of an indexed project's .gproj, with each dep GUID resolved against the project-index. Resolved entries show the target file + source; unresolved entries flag missing prerequisites. Use for pre-publish dep audit or to understand a third-party mod's surface.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/list_dependencies.md](../../../data/kb/census/tools/list_dependencies.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `project_id` | string | yes | Project ID (from .gproj `ID` property, e.g. 'Test1', 'core') |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/list_dependencies.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.gproj` |
