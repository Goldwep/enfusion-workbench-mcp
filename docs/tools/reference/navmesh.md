# navmesh

```text
Offline navmesh files of a world: status (AIWorld config, navmesh files config, .nmn header, .NavData tile count, size and age), header, tiles (paged), config, projects (.gproj navmesh projects), overrideConfig (project override of a vanilla Navmesh_*.conf, dry run unless confirm). Baking is not here: see wb_navmesh and wb_cli_run.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/navmesh.md](../../../data/kb/census/tools/navmesh.md) |

## Actions (6)

`status`, `header`, `tiles`, `config`, `projects`, `overrideConfig`

## Input parameters (9)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `status`, `header`, `tiles`, `config`, `projects`, `overrideConfig`. |
| `path` | string | no | status: .ent/.layer/.et/.conf/.nmn; header: .nmn/.ntile; tiles: .nmn; config, overrideConfig: .conf; projects: .gproj (default the project's). Project-relative or a game path. |
| `cursor` | string | no | tiles: the nextCursor of the page before. |
| `limit` | integer | no | tiles, projects: rows (default 100). |
| `navmeshFile` | string | no | overrideConfig: the {GUID}path.nmn the copy points at. |
| `overrides` | array<string> | no | overrideConfig: partial .nmn files to append (gated). |
| `overwrite` | boolean | no | overrideConfig: replace a project file (a .bak is kept). |
| `confirm` | boolean | no | overrideConfig: true writes; otherwise a dry run. |
| `projectPath` | string | no | Addon root. Uses the configured project when omitted. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/navmesh.<action>`. A row that links several actions is counted under each (14 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `config` | 2 | T2 1, T5 1 | `file:.conf`, `mcp:action/navmesh.config` |
| `header` | 3 | T2 2, T5 1 | `file:.nmn`, `file:.ntile`, `mcp:action/navmesh.header` |
| `overrideConfig` | 2 | T2 1, T3 1 | `file:.conf`, `mcp:action/navmesh.overrideConfig` |
| `projects` | 2 | T2 1, T5 1 | `file:.gproj`, `mcp:action/navmesh.projects` |
| `status` | 3 | T2 2, T5 1 | `file:.conf`, `file:.nmn`, `mcp:action/navmesh.status` |
| `tiles` | 2 | T2 1, T5 1 | `file:.nmn`, `mcp:action/navmesh.tiles` |
