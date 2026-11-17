# ui_localization_audit

```text
Audit localization coverage for a .gproj. Walks every declared StringTableDefinition, parses the source .st and each language's runtime .conf, and reports missing keys / orphan entries / per-language counts, then scans every .layout under the project for #KEY references and reports missing, case-only-mismatched and unused keys with counts and file references. Pure file parsing — no Workbench connection required.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/ui_localization_audit.md](../../../data/kb/census/tools/ui_localization_audit.md) |

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `gproj_path` | string | yes | Path to a .gproj file. Absolute or relative to MCP cwd. |
| `extra_tables` | array<string> | no | Extra runtime string tables (.conf with an Ids block; project-relative or absolute) whose keys count as defined, e.g. an extracted vanilla Language/localization.en_us.conf. Their keys are never reported unused. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/ui_localization_audit.<action>`. A row that links several actions is counted under each (3 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 3 | T2 3 | `file:.gproj`, `file:.layout`, `file:.st` |
