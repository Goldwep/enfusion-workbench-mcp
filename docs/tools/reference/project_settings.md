# project_settings

```text
Read and edit the project .gproj as a file. Actions: read; set (key, value, optional platform); addDependency / removeDependency (guid); addPlatform / removePlatform (platform). Edits only an existing .gproj under the project; a dry run showing the diff unless confirm: true; ID and GUID are not settable. Reads also take a game addon .gproj.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/project_settings.md](../../../data/kb/census/tools/project_settings.md) |

## Actions (6)

`read`, `set`, `addDependency`, `removeDependency`, `addPlatform`, `removePlatform`

## Input parameters (10)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `read`, `set`, `addDependency`, `removeDependency`, `addPlatform`, `removePlatform`. |
| `path` | string | no | Project-relative .gproj; omitted: the one in the project root. |
| `key` | string | no | set: setting name, e.g. TITLE. |
| `value` | string \| number \| boolean | no | set: new value. |
| `quoted` | boolean | no | set: force quoting on or off. |
| `platform` | string | no | set: edit in this platform's block. addPlatform/removePlatform: the name (PC, XBOX_ONE, ...). |
| `guid` | string | no | addDependency/removeDependency: 16-hex GUID. |
| `discard` | boolean | no | removePlatform: drop a block that holds settings. |
| `confirm` | boolean | no | Write the change; without it nothing is written. |
| `projectPath` | string | no | Project root. Uses the configured project when omitted. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/project_settings.<action>`. A row that links several actions is counted under each (12 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `addDependency` | 2 | T2 1, T5 1 | `file:.gproj`, `mcp:action/project_settings.addDependency` |
| `addPlatform` | 2 | T2 1, T5 1 | `file:.gproj`, `mcp:action/project_settings.addPlatform` |
| `read` | 2 | T2 1, T5 1 | `file:.gproj`, `mcp:action/project_settings.read` |
| `removeDependency` | 2 | T2 1, T5 1 | `file:.gproj`, `mcp:action/project_settings.removeDependency` |
| `removePlatform` | 2 | T2 1, T5 1 | `file:.gproj`, `mcp:action/project_settings.removePlatform` |
| `set` | 2 | T2 1, T5 1 | `file:.gproj`, `mcp:action/project_settings.set` |
