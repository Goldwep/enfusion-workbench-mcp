# wb_anim_debug

```text
Play mode: anim graph variables, tags, commands, ProcAnim signals of one entity.
Read:
vars: Graph variable values
tags: Tags or events set this frame
procAnim: ProcAnim controllers, signals, bones
Mutating:
set: Set a graph variable (memory, play only)
command: Call a graph command
btBreakpoint: Toggle the AI behavior-tree breakpoint
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Handler contract | `contracts/EMCP_WB_AnimDebug.json` (EMCP_WB_AnimDebug) |
| Census KB page | [data/kb/census/tools/wb_anim_debug.md](../../../data/kb/census/tools/wb_anim_debug.md) |

## Actions (6)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `vars` | no | no | Graph variable values | `target`* (string), `names`* (array<string>), `varTypes`* (array<string>) |
| `tags` | no | no | Tags or events set this frame | `target`* (string), `names`* (array<string>), `kind` (string) |
| `procAnim` | no | no | ProcAnim controllers, signals, bones | `target`* (string), `ctrl` (int) |
| `set` | yes | no | Set a graph variable (memory, play only) Refuses: UNPROVEN until P-W4-19: Set*Variable in play mode is not yet proven safe. | `target`* (string), `name`* (string), `varType`* (string), `value`* (string) |
| `command` | yes | no | Call a graph command Refuses: UNPROVEN until P-W4-19: CallCommand in play mode is not yet proven safe. | `target`* (string), `name`* (string), `intParam` (int), `floatParam` (string) |
| `btBreakpoint` | yes | no | Toggle the AI behavior-tree breakpoint Refuses: UNPROVEN until P-W4-21: SetBtBreakpoint may pause play or open the BT debugger. | `target`* (string), `enable`* (bool) |

`*` marks a required parameter of that action.

## Input parameters (12)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `vars`, `tags`, `procAnim`, `set`, `command`, `btBreakpoint`. |
| `target` | string | no | entity:<ref> of a play-mode entity |
| `names` | array<string> | no | variable names from the .agr |
| `varTypes` | array<string> | no | int\|float\|bool per name |
| `kind` | string | no | tag (default) or event |
| `ctrl` | integer | no | controller index, default 0 |
| `name` | string | no |  |
| `varType` | string | no | int\|float\|bool |
| `value` | string \| number \| boolean | no | text; bool true\|false\|1\|0 |
| `intParam` | integer | no |  |
| `floatParam` | string \| number \| boolean | no | float as text |
| `enable` | boolean | no |  |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_anim_debug.<action>`. A row that links several actions is counted under each (12 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `btBreakpoint` | 2 | T3 2 | `mcp:action/wb_anim_debug.btBreakpoint`, `mcp:handler-action/EMCP_WB_AnimDebug.btBreakpoint` |
| `command` | 2 | T3 2 | `mcp:action/wb_anim_debug.command`, `mcp:handler-action/EMCP_WB_AnimDebug.command` |
| `procAnim` | 2 | T3 2 | `mcp:action/wb_anim_debug.procAnim`, `mcp:handler-action/EMCP_WB_AnimDebug.procAnim` |
| `set` | 2 | T3 2 | `mcp:action/wb_anim_debug.set`, `mcp:handler-action/EMCP_WB_AnimDebug.set` |
| `tags` | 2 | T3 2 | `mcp:action/wb_anim_debug.tags`, `mcp:handler-action/EMCP_WB_AnimDebug.tags` |
| `vars` | 2 | T3 2 | `mcp:action/wb_anim_debug.vars`, `mcp:handler-action/EMCP_WB_AnimDebug.vars` |
