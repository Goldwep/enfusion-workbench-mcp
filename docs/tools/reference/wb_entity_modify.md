# wb_entity_modify

```text
1.x alias: move, rotate, rename, reparent, getWorldTransform -> wb_entity; makeVisible -> wb_view select; property actions -> wb_container on entity:name:<name>. listArrayItems: 1.x handler.
```

| Field | Value |
| --- | --- |
| Tier | alias |
| Registered under ENFUSION_TOOLSET | all |
| Census KB page | [data/kb/census/tools/wb_entity_modify.md](../../../data/kb/census/tools/wb_entity_modify.md) |

## Actions (14)

`move`, `rotate`, `rename`, `reparent`, `setProperty`, `clearProperty`, `getProperty`, `listProperties`, `listArrayItems`, `addArrayItem`, `removeArrayItem`, `setObjectClass`, `getWorldTransform`, `makeVisible`

## Input parameters (6)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes |  |
| `action` | string | yes | One of: `move`, `rotate`, `rename`, `reparent`, `setProperty`, `clearProperty`, `getProperty`, `listProperties`, `listArrayItems`, `addArrayItem`, `removeArrayItem`, `setObjectClass`, `getWorldTransform`, `makeVisible`. |
| `value` | string | no |  |
| `propertyPath` | string | no | component class or dotted path |
| `propertyKey` | string | no |  |
| `memberIndex` | number | no | Default: `-1`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_entity_modify.<action>`. A row that links several actions is counted under each (28 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `addArrayItem` | 2 | T2 1, T3 1 | `mcp:action/wb_entity_modify.addArrayItem`, `mcp:handler-action/EMCP_WB_ModifyEntity.addArrayItem` |
| `clearProperty` | 2 | T2 1, T3 1 | `mcp:action/wb_entity_modify.clearProperty`, `mcp:handler-action/EMCP_WB_ModifyEntity.clearProperty` |
| `getProperty` | 2 | T2 1, T3 1 | `mcp:action/wb_entity_modify.getProperty`, `mcp:handler-action/EMCP_WB_ModifyEntity.getProperty` |
| `getWorldTransform` | 2 | T2 1, T3 1 | `mcp:action/wb_entity_modify.getWorldTransform`, `mcp:handler-action/EMCP_WB_ModifyEntity.getWorldTransform` |
| `listArrayItems` | 2 | T2 1, T3 1 | `mcp:action/wb_entity_modify.listArrayItems`, `mcp:handler-action/EMCP_WB_ModifyEntity.listArrayItems` |
| `listProperties` | 2 | T2 1, T3 1 | `mcp:action/wb_entity_modify.listProperties`, `mcp:handler-action/EMCP_WB_ModifyEntity.listProperties` |
| `makeVisible` | 2 | T2 1, T3 1 | `mcp:action/wb_entity_modify.makeVisible`, `mcp:handler-action/EMCP_WB_ModifyEntity.makeVisible` |
| `move` | 2 | T2 1, T3 1 | `mcp:action/wb_entity_modify.move`, `mcp:handler-action/EMCP_WB_ModifyEntity.move` |
| `removeArrayItem` | 2 | T2 1, T3 1 | `mcp:action/wb_entity_modify.removeArrayItem`, `mcp:handler-action/EMCP_WB_ModifyEntity.removeArrayItem` |
| `rename` | 2 | T2 1, T3 1 | `mcp:action/wb_entity_modify.rename`, `mcp:handler-action/EMCP_WB_ModifyEntity.rename` |
| `reparent` | 2 | T2 1, T3 1 | `mcp:action/wb_entity_modify.reparent`, `mcp:handler-action/EMCP_WB_ModifyEntity.reparent` |
| `rotate` | 2 | T2 1, T3 1 | `mcp:action/wb_entity_modify.rotate`, `mcp:handler-action/EMCP_WB_ModifyEntity.rotate` |
| `setObjectClass` | 2 | T2 1, T3 1 | `mcp:action/wb_entity_modify.setObjectClass`, `mcp:handler-action/EMCP_WB_ModifyEntity.setObjectClass` |
| `setProperty` | 2 | T2 1, T3 1 | `mcp:action/wb_entity_modify.setProperty`, `mcp:handler-action/EMCP_WB_ModifyEntity.setProperty` |
