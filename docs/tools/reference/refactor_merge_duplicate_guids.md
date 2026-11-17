# refactor_merge_duplicate_guids

```text
Find resource files that claim the same 16-hex GUID (collisions). Walks the project root for each .gproj GUID and every .meta sidecar's Name GUID (entity IDs in .et files are not GUIDs), and groups by GUID. v1 is DIAGNOSE-ONLY — the recommended fix is `refactor_replace_guid` per duplicate to issue fresh GUIDs. Catches the most common Workshop fork bug: cloning a mod without changing its addon GUID.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/refactor_merge_duplicate_guids.md](../../../data/kb/census/tools/refactor_merge_duplicate_guids.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `project_root` | string | yes | Absolute path to the project to scan |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/refactor_merge_duplicate_guids.<action>`. A row that links several actions is counted under each (5 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 5 | T2 5 | `file:.conf`, `file:.ent`, `file:.et` |
