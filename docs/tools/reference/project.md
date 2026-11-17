# project

```text
Browse, read, or write files in an Arma Reforger Workbench project directory. Use action='browse' to list files, action='read' to read a file, action='write' to write a file.
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Census KB page | [data/kb/census/tools/project.md](../../../data/kb/census/tools/project.md) |

## Actions (3)

`browse`, `read`, `write`

## Input parameters (6)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | Operation to perform: browse (list files), read (read a file), write (write a file) One of: `browse`, `read`, `write`. |
| `path` | string | no | (browse) Subdirectory to list within the project (e.g., 'Scripts/Game', 'Prefabs'). Omit for project root. (read) Relative path within the project (e.g., 'Scripts/Game/MyScript.c', 'MyMod.gproj'). (write) Relative path within the project (e.g., 'Scripts/Game/MyScript.c'). |
| `pattern` | string | no | (browse) File extension filter (e.g., '*.c', '*.et') |
| `content` | string | no | (write) File content to write |
| `createDirectories` | boolean | no | (write) Create parent directories if they don't exist. Default: true. |
| `projectPath` | string | no | Absolute path to the project directory. Uses configured default if omitted. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/project.<action>`. A row that links several actions is counted under each (3 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `browse` | 1 | T3 1 | `mcp:action/project.browse` |
| `read` | 1 | T3 1 | `mcp:action/project.read` |
| `write` | 1 | T3 1 | `mcp:action/project.write` |
