# weapon_pose_lint

```text
Regex-only check of a character `.agr` GlobalTags block (WEAPON, ADS, STANCE ...). Missing tags are error findings (not a tool error), unknown tags warnings. No parser and no .anm cross-reference, so it is a fast pre-publish gate; `animation_graph inspect` goes deeper. Why regex-only and the default tag set: KB anim-lint-tools.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/weapon_pose_lint.md](../../../data/kb/census/tools/weapon_pose_lint.md) |

## Input parameters (2)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `agr_path` | string | yes | Absolute path to a character .agr file. Must not start with '-' (flag-smuggle guard). |
| `expected_tags` | array<string> | no | Override the expected tag set. Defaults to "WEAPON", "ADS", "STANCE", "CROUCH", "PRONE", "RELOAD". Comparison is case-sensitive — match the engine's behavior. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/weapon_pose_lint.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.agr` |
