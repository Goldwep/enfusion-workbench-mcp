# script_class_hierarchy

```text
Render a class's inheritance + modded chain as an ASCII tree. Walks the project's `.c` files to find both `class Foo : Bar` parent links AND every `modded class Foo` override. Stops at the topmost ancestor not defined in the project (typically an engine/Doxygen class).
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/script_class_hierarchy.md](../../../data/kb/census/tools/script_class_hierarchy.md) |

## Input parameters (3)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `project_root` | string | yes | Absolute path to the project to scan |
| `class_name` | string | yes | Class name to start walking from |
| `max_depth` | number | no | Stop after this many parent hops (default 32, max 64) Default: `32`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/script_class_hierarchy.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.c` |
