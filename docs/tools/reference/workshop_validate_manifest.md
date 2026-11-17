# workshop_validate_manifest

```text
Pre-flight a `.gproj` against Workshop publish constraints — required fields, length limits, preview/screenshot size caps, dependency well-formedness, and dev-handler leak guard. Use BEFORE running `-publishAddon*` to catch the most common reject reasons without burning a CLI cycle.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/workshop_validate_manifest.md](../../../data/kb/census/tools/workshop_validate_manifest.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `gproj_path` | string | yes | Path to the .gproj file to validate (absolute or repo-relative) |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/workshop_validate_manifest.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.gproj` |
