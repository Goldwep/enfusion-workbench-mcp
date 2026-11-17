# Tool: wb_validate

Material / texture validation with path precheck

Row: mcp:tool/wb_validate. Tier T2/T2.

## Actions (3)

| action | risk | what |
| --- | --- | --- |
| fixTexture | mutating | mcp action 'wb_validate.fixTexture' in ResourceManager under wb_validate |
| material | mutating | mcp action 'wb_validate.material' in ResourceManager under wb_validate |
| texture | mutating | mcp action 'wb_validate.texture' in ResourceManager under wb_validate |

## Rows linked to this tool (20)

- api:MaterialValidatorResponse.MaterialValidatorResponse/0 (material read)
- api:MaterialValidatorUtils.CheckDefaults/2 (material read)
- api:MaterialValidatorUtils.CheckDependencies/2 (material read)
- api:MaterialValidatorUtils.CheckExtremes/4 (material read)
- api:MaterialValidatorUtils.CheckTextures/2 (material read)
- api:MaterialValidatorUtils.ValidateUVs/4 (material read)
- api:TextureTypes.CheckAncestors/4 (texture read)
- api:TextureTypes.CheckConfigurations/3 (texture read)
- api:TextureTypes.CheckSuspiciousNonPcSetting/3 (texture read)
- api:TextureTypes.CheckUnnecessarySettingInPc/3 (texture read)
- api:TextureTypes.CheckWrongPropertyValues/4 (texture read)
- api:TextureTypes.TextureTypes/0 (texture read)
- mcp:action/wb_validate.fixTexture (fixTexture drive)
- mcp:action/wb_validate.material (material drive)
- mcp:action/wb_validate.texture (texture drive)
- mcp:handler-action/EMCP_WB_Validate.fixTexture (fixTexture drive, fixTexture read)
- mcp:handler-action/EMCP_WB_Validate.material (material drive, material read)
- mcp:handler-action/EMCP_WB_Validate.texture (texture drive, texture read)
- net:handler/MaterialValidator (material read)
- net:handler/TextureValidator (texture read)
