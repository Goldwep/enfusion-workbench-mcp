# project_validate

```text
Run lint/validation against a target file under the requested scope. Currently shipped scopes: `mod` (.gproj workshop pre-flight), `scenario` (.conf basic shape), `faction` (SCR_Faction .conf — F1 required fields, F2 key shape, F3 color range, F4 duplicate keys, F5 orphan factions). Future scopes: ui (L4), material (L4/L8), anim (L8). Single-tool design avoids per-domain `*_validate` proliferation.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/project_validate.md](../../../data/kb/census/tools/project_validate.md) |

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `scope` | string | yes | What kind of validation to run One of: `mod`, `scenario`, `faction`. |
| `target` | string | yes | Path to the file to validate (absolute or repo-relative). For scope=faction this may be either a .conf file or the project root directory. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/project_validate.<action>`. A row that links several actions is counted under each (10 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `faction` | 3 | T2 2, T3 1 | `file:.conf`, `file:.gproj`, `mcp:action/project_validate.faction` |
| `mod` | 3 | T2 2, T3 1 | `file:.conf`, `file:.gproj`, `mcp:action/project_validate.mod` |
| `scenario` | 4 | T2 3, T3 1 | `file:.conf`, `file:.ent`, `file:.gproj` |
