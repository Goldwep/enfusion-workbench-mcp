# particle_inspect

```text
Alias of particle inspect. Summarize a .ptc particle effect (EffectDef > Emitters > EmitterDef): per emitter its name, shape, rates, lifetime, LOD range, material and prefab, and its curve blocks, plus the effect-level keys. Takes an absolute path, a project path or a game path; the other particle actions are on the particle tool.
```

| Field | Value |
| --- | --- |
| Tier | alias |
| Registered under ENFUSION_TOOLSET | all |
| Census KB page | [data/kb/census/tools/particle_inspect.md](../../../data/kb/census/tools/particle_inspect.md) |

## Input parameters (3)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `particle_path` | string | yes | The .ptc: absolute path, project-relative path or game path. Must not start with '-'. |
| `cursor` | string | no | Cursor from the last page of emitters. |
| `limit` | integer | no | Emitters per page. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/particle_inspect.<action>`. A row that links several actions is counted under each (1 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `run` | 1 | T2 1 | `file:.ptc` |
