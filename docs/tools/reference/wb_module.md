# wb_module

```text
Workbench modules (the present ones).
Read:
list: Module names (no open check)
Mutating:
info: Containers; opens module if closed
open: Open a module
front: Bring a module window to front
close: Refused: the owner closes by hand
setResource: Open a path:<rel> resource in its editor
save: Save the open world: dry run, or confirm (anim editors: NO_DOCUMENT)
action: Run an allow-listed menuPath
```

| Field | Value |
| --- | --- |
| Tier | core |
| Registered under ENFUSION_TOOLSET | core, extended, all |
| Handler contract | `contracts/EMCP_WB_Module.json` (EMCP_WB_Module) |
| Census KB page | [data/kb/census/tools/wb_module.md](../../../data/kb/census/tools/wb_module.md) |

## Actions (8)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `list` | no | no | Module names (no open check) | none |
| `info` | yes | no | Containers; opens module if closed | `moduleName`* (string) |
| `open` | yes | no | Open a module | `moduleName`* (string) |
| `front` | yes | no | Bring a module window to front Refuses: BringModuleWindowToFront is a NET native: the TS tool calls it; the handler refuses front. | `moduleName`* (string) |
| `close` | yes | no | Refused: the owner closes by hand Refuses: No proven call tells whether the document is dirty (DEC-045); the handler refuses close. | `moduleName`* (string) |
| `setResource` | yes | no | Open a path:<rel> resource in its editor | `moduleName`* (string), `path`* (string) |
| `save` | yes | yes | Save the open world: dry run, or confirm (anim editors: NO_DOCUMENT) Refuses: NO_DOCUMENT in AnimEditor, BehaviorEditor and ProcAnimEditor: on 1.9.0.37 they expose no container for the open file (P-W4-10 killed); nothing is sent | `moduleName`* (string), `confirm` (bool) |
| `action` | yes | no | Run an allow-listed menuPath | `moduleName`* (string), `menuPath`* (array<string>), `keepFocus` (bool) |

`*` marks a required parameter of that action.

## Input parameters (6)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `list`, `info`, `open`, `front`, `close`, `setResource`, `save`, `action`. |
| `module` | string | no | every action but list One of: `AnimEditor`, `AudioEditor`, `BehaviorEditor`, `LocalizationEditor`, `ParticleEditor`, `ProcAnimEditor`, `ResourceManager`, `ScriptEditor`, `WorldEditor`. |
| `target` | string | no | setResource: path:<rel>; save: open:<module> |
| `menuPath` | array<string> | no | action: menu path segments |
| `keepFocus` | boolean | no | action: default true |
| `confirm` | boolean | no | save/action: true; else dry run |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_module.<action>`. A row that links several actions is counted under each (81 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `action` | 60 | T2 1, T3 9, T5 50 | `mcp:action/wb_module.action`, `mcp:handler-action/EMCP_WB_Module.action`, `ui:AnimEditor/menu-item/Edit/Undo` |
| `close` | 2 | T2 1, T3 1 | `mcp:action/wb_module.close`, `mcp:handler-action/EMCP_WB_Module.close` |
| `front` | 3 | T2 1, T3 2 | `mcp:action/wb_module.front`, `mcp:handler-action/EMCP_WB_Module.front`, `net:native/BringModuleWindowToFront` |
| `info` | 6 | T1 4, T2 1, T3 1 | `mcp:action/wb_module.info`, `mcp:handler-action/EMCP_WB_Module.info`, `ui:AnimEditor/module/AnimEditor` |
| `list` | 2 | T2 1, T3 1 | `mcp:action/wb_module.list`, `mcp:handler-action/EMCP_WB_Module.list` |
| `open` | 4 | T1 1, T2 1, T3 2 | `mcp:action/wb_module.open`, `mcp:handler-action/EMCP_WB_Module.open`, `net:native/OpenResource` |
| `save` | 2 | T2 1, T3 1 | `mcp:action/wb_module.save`, `mcp:handler-action/EMCP_WB_Module.save` |
| `setResource` | 2 | T2 1, T3 1 | `mcp:action/wb_module.setResource`, `mcp:handler-action/EMCP_WB_Module.setResource` |
