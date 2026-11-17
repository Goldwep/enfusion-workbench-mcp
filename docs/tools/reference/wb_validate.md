# wb_validate

```text
Bohemia material and texture validators, run as data. path: project-relative or a game resource.
Read:
material: MaterialValidatorUtils checks
texture: TextureTypes checks per configuration
Mutating:
fixTexture: Apply Bohemia texture fixes
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Handler contract | `contracts/EMCP_WB_Validate.json` (EMCP_WB_Validate) |
| Census KB page | [data/kb/census/tools/wb_validate.md](../../../data/kb/census/tools/wb_validate.md) |

## Actions (3)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `material` | no | no | MaterialValidatorUtils checks | `path`* (string) |
| `texture` | no | no | TextureTypes checks per configuration | `path`* (string), `typeName` (string) |
| `fixTexture` | yes | yes | Apply Bohemia texture fixes | `path`* (string), `typeName` (string), `rebuild` (bool), `confirm` (bool) |

`*` marks a required parameter of that action.

## Input parameters (5)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `material`, `texture`, `fixTexture`. |
| `path` | string | no | .emat, project or game |
| `typeName` | string | no | e.g. co, nohq, fnt, unspecified |
| `rebuild` | boolean | no | rebuild after the save |
| `confirm` | boolean | no | true writes; else a dry run |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_validate.<action>`. A row that links several actions is counted under each (20 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `fixTexture` | 2 | T5 2 | `mcp:action/wb_validate.fixTexture`, `mcp:handler-action/EMCP_WB_Validate.fixTexture` |
| `material` | 9 | T2 1, T3 6, T5 2 | `api:MaterialValidatorResponse.MaterialValidatorResponse/0`, `api:MaterialValidatorUtils.CheckDefaults/2`, `api:MaterialValidatorUtils.CheckDependencies/2` |
| `texture` | 9 | T2 1, T3 6, T5 2 | `api:TextureTypes.CheckAncestors/4`, `api:TextureTypes.CheckConfigurations/3`, `api:TextureTypes.CheckSuspiciousNonPcSetting/3` |
