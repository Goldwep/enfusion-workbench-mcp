# material_inspect

```text
Read-only inspector for an Enfusion `.emat` material file. Parses the material root and reports the shader class, every texture slot (with GUID + path + resolved index entry when known), and the remaining tunable parameters at the root. Use this to audit a single material before swapping textures, or to see what a base material exposes for tuning. Pure filesystem read + project-index lookups — no DB writes.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/material_inspect.md](../../../data/kb/census/tools/material_inspect.md) |

## Input parameters (1)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `material_path` | string | yes | Path to the `.emat` file. Absolute path, or repo-relative path resolved against the configured project path (e.g., 'Materials/MyMat.emat'). |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/material_inspect.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.emat` |
