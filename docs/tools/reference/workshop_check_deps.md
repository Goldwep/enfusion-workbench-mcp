# workshop_check_deps

```text
Read a `.gproj` from disk, extract its Dependencies block, and resolve each dep GUID the way WORKBENCH does: against the Workbench addons dir, the folders next to the project, and the base game + Tools installs. Deps that only exist in the game's workshop downloads (`My Games\ArmaReforger\addons`) are flagged separately with the copy remedy — Workbench never searches that folder, so such deps pop 'Missing Addon Dependencies' at open even though the game runs them fine. Use before publish, before wb_validate_scripts / wb_launch on a freshly-cloned project, or when diagnosing 'mod won't load'.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/workshop_check_deps.md](../../../data/kb/census/tools/workshop_check_deps.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `gproj_path` | string | yes | Path to the .gproj file (absolute or repo-relative) |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/workshop_check_deps.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.gproj` |
