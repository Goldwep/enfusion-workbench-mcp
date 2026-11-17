# material_diff

```text
Compute a semantic diff between two Enfusion `.emat` material files. Compares shader class, className, inheritance, texture slots (keyed by slot name), and tunable parameters, reporting added / removed / changed entries in each bucket. Use for reviewing material edits before merging from a beta branch, or for spotting unintended texture swaps. Pure filesystem read - no project-index required.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/material_diff.md](../../../data/kb/census/tools/material_diff.md) |

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `before_path` | string | yes | Absolute path to the BEFORE `.emat` file (e.g., main-branch version). |
| `after_path` | string | yes | Absolute path to the AFTER `.emat` file (e.g., Beta-Branch version). |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/material_diff.<action>`. A row that links several actions is counted under each (2 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 2 | T0 1, T2 1 | `api:method/Diff materials`, `file:.emat` |
