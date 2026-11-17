# Census: no module, kind handler-action

64 rows (0 aggregate excluded).

## What it is

Module none: mcp 64. Seen in builds 1.8.0.13 to 1.9.0.37.

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mcp | 0 | 0 | 5 | 17 | 4 | 38 | 64 |

## By kind

- handler-action: 64

## By risk

- mutating: 55
- safe: 9

## Rows by kind

### handler-action (64)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| mcp:handler-action/EMCP_WB_Audio.audible | T5/T5 | net-api-handler | [wb_audio.audible](../../tools/wb_audio.md) drive, [wb_audio.audible](../../tools/wb_audio.md) read |
| mcp:handler-action/EMCP_WB_Audio.entityEvents | T3/T5 | candidate: net-api-handler | [wb_audio.entityEvents](../../tools/wb_audio.md) read |
| mcp:handler-action/EMCP_WB_Audio.entityPlay | T3/T5 | candidate: net-api-handler | [wb_audio.entityPlay](../../tools/wb_audio.md) drive |
| mcp:handler-action/EMCP_WB_Audio.isPlaying | T5/T5 | net-api-handler | [wb_audio.isPlaying](../../tools/wb_audio.md) drive, [wb_audio.isPlaying](../../tools/wb_audio.md) read |
| mcp:handler-action/EMCP_WB_Audio.masters | T5/T5 | net-api-handler | [wb_audio.masters](../../tools/wb_audio.md) drive, [wb_audio.masters](../../tools/wb_audio.md) read |
| mcp:handler-action/EMCP_WB_Audio.open | T3/T5 | candidate: net-api-handler | [wb_audio.open](../../tools/wb_audio.md) drive |
| mcp:handler-action/EMCP_WB_Audio.outputStates | T5/T5 | net-api-handler | [wb_audio.outputStates](../../tools/wb_audio.md) drive, [wb_audio.outputStates](../../tools/wb_audio.md) read |
| mcp:handler-action/EMCP_WB_Audio.pause | T3/T5 | candidate: net-api-handler | [wb_audio.pause](../../tools/wb_audio.md) drive |
| mcp:handler-action/EMCP_WB_Audio.play | T5/T5 | net-api-handler | [wb_audio.play](../../tools/wb_audio.md) drive, [wb_audio.play](../../tools/wb_audio.md) drive |
| mcp:handler-action/EMCP_WB_Audio.playSound | T5/T5 | net-api-handler | [wb_audio.playSound](../../tools/wb_audio.md) drive, [wb_audio.playSound](../../tools/wb_audio.md) drive |
| mcp:handler-action/EMCP_WB_Audio.resetVariables | T3/T5 | candidate: net-api-handler | [wb_audio.resetVariables](../../tools/wb_audio.md) drive |
| mcp:handler-action/EMCP_WB_Audio.setMaster | T5/T5 | net-api-handler | [wb_audio.setMaster](../../tools/wb_audio.md) drive, [wb_audio.setMaster](../../tools/wb_audio.md) drive |
| mcp:handler-action/EMCP_WB_Audio.setSignal | T3/T5 | candidate: net-api-handler | [wb_audio.setSignal](../../tools/wb_audio.md) drive |
| mcp:handler-action/EMCP_WB_Audio.setVariable | T5/T5 | net-api-handler | [wb_audio.setVariable](../../tools/wb_audio.md) drive, [wb_audio.setVariable](../../tools/wb_audio.md) drive |
| mcp:handler-action/EMCP_WB_Audio.soundMap | T3/T5 | candidate: net-api-handler | [wb_audio.soundMap](../../tools/wb_audio.md) read |
| mcp:handler-action/EMCP_WB_Audio.stop | T5/T5 | net-api-handler | [wb_audio.stop](../../tools/wb_audio.md) drive, [wb_audio.stop](../../tools/wb_audio.md) drive |
| mcp:handler-action/EMCP_WB_Audio.variable | T5/T5 | net-api-handler | [wb_audio.variable](../../tools/wb_audio.md) drive, [wb_audio.variable](../../tools/wb_audio.md) read |
| mcp:handler-action/EMCP_WB_Container.arrayAdd | T4/T5 | net-api-handler | [wb_container.arrayAdd](../../tools/wb_container.md) drive, [wb_container.arrayAdd](../../tools/wb_container.md) read |
| mcp:handler-action/EMCP_WB_Container.arrayMove | T3/T5 | candidate: net-api-handler | [wb_container.arrayMove](../../tools/wb_container.md) drive, [wb_container.arrayMove](../../tools/wb_container.md) read |
| mcp:handler-action/EMCP_WB_Container.arrayRemove | T4/T5 | net-api-handler | [wb_container.arrayRemove](../../tools/wb_container.md) drive, [wb_container.arrayRemove](../../tools/wb_container.md) read |
| mcp:handler-action/EMCP_WB_Container.clear | T5/T5 | net-api-handler | [wb_container.clear](../../tools/wb_container.md) drive, [wb_container.clear](../../tools/wb_container.md) read |
| mcp:handler-action/EMCP_WB_Container.describe | T5/T5 | net-api-handler | [wb_container.describe](../../tools/wb_container.md) drive, [wb_container.describe](../../tools/wb_container.md) read |
| mcp:handler-action/EMCP_WB_Container.get | T5/T5 | net-api-handler | [wb_container.get](../../tools/wb_container.md) drive, [wb_container.get](../../tools/wb_container.md) read |
| mcp:handler-action/EMCP_WB_Container.save | T4/T5 | net-api-handler | [wb_container.save](../../tools/wb_container.md) drive, [wb_container.save](../../tools/wb_container.md) read |
| mcp:handler-action/EMCP_WB_Container.set | T4/T5 | net-api-handler | [wb_container.set](../../tools/wb_container.md) drive, [wb_container.set](../../tools/wb_container.md) read |
| mcp:handler-action/EMCP_WB_Container.setClass | T5/T5 | net-api-handler | [wb_container.setClass](../../tools/wb_container.md) drive, [wb_container.setClass](../../tools/wb_container.md) read |
| mcp:handler-action/EMCP_WB_Diag.catalog | T3/T5 | candidate: net-api-handler | [wb_diag.catalog](../../tools/wb_diag.md) read |
| mcp:handler-action/EMCP_WB_Diag.get | T3/T5 | candidate: net-api-handler | [wb_diag.get](../../tools/wb_diag.md) read |
| mcp:handler-action/EMCP_WB_Diag.info | T5/T5 | net-api-handler | [wb_diag.info](../../tools/wb_diag.md) drive, [wb_diag.info](../../tools/wb_diag.md) read |
| mcp:handler-action/EMCP_WB_Diag.select | T3/T5 | candidate: net-api-handler | [wb_diag.select](../../tools/wb_diag.md) drive |
| mcp:handler-action/EMCP_WB_Diag.set | T3/T5 | candidate: net-api-handler | [wb_diag.set](../../tools/wb_diag.md) drive |
| mcp:handler-action/EMCP_WB_Info.run | T2/T5 | candidate: net-api-handler | none |
| mcp:handler-action/EMCP_WB_Meta.assignMaterial | T2/T5 | candidate: net-api-handler | [wb_meta.assignMaterial](../../tools/wb_meta.md) read |
| mcp:handler-action/EMCP_WB_Meta.clear | T5/T5 | net-api-handler | [wb_meta.clear](../../tools/wb_meta.md) drive, [wb_meta.clear](../../tools/wb_meta.md) read |
| mcp:handler-action/EMCP_WB_Meta.get | T5/T5 | net-api-handler | [wb_meta.get](../../tools/wb_meta.md) drive, [wb_meta.get](../../tools/wb_meta.md) read |
| mcp:handler-action/EMCP_WB_Meta.set | T5/T5 | net-api-handler | [wb_meta.set](../../tools/wb_meta.md) drive, [wb_meta.set](../../tools/wb_meta.md) read |
| mcp:handler-action/EMCP_WB_Meta.setAncestor | T5/T5 | net-api-handler | [wb_meta.setAncestor](../../tools/wb_meta.md) drive, [wb_meta.setAncestor](../../tools/wb_meta.md) read |
| mcp:handler-action/EMCP_WB_Meta.vars | T5/T5 | net-api-handler | [wb_meta.vars](../../tools/wb_meta.md) drive, [wb_meta.vars](../../tools/wb_meta.md) read |
| mcp:handler-action/EMCP_WB_Plugin.describe | T3/T5 | candidate: net-api-handler | [wb_plugin.describe](../../tools/wb_plugin.md) read |
| mcp:handler-action/EMCP_WB_Plugin.getSettings | T3/T5 | candidate: net-api-handler | [wb_plugin.getSettings](../../tools/wb_plugin.md) read |

24 more: wb_census find with module=none kind=handler-action.

## Below target (26)

- T2 to T5: 5
- T3 to T5: 17
- T4 to T5: 4

| id | tier | path |
| --- | --- | --- |
| mcp:handler-action/EMCP_WB_Audio.entityEvents | T3/T5 | candidate: net-api-handler |
| mcp:handler-action/EMCP_WB_Audio.entityPlay | T3/T5 | candidate: net-api-handler |
| mcp:handler-action/EMCP_WB_Audio.open | T3/T5 | candidate: net-api-handler |
| mcp:handler-action/EMCP_WB_Audio.pause | T3/T5 | candidate: net-api-handler |
| mcp:handler-action/EMCP_WB_Audio.resetVariables | T3/T5 | candidate: net-api-handler |
| mcp:handler-action/EMCP_WB_Audio.setSignal | T3/T5 | candidate: net-api-handler |
| mcp:handler-action/EMCP_WB_Audio.soundMap | T3/T5 | candidate: net-api-handler |
| mcp:handler-action/EMCP_WB_Container.arrayAdd | T4/T5 | net-api-handler |
| mcp:handler-action/EMCP_WB_Container.arrayMove | T3/T5 | candidate: net-api-handler |
| mcp:handler-action/EMCP_WB_Container.arrayRemove | T4/T5 | net-api-handler |
| mcp:handler-action/EMCP_WB_Container.save | T4/T5 | net-api-handler |
| mcp:handler-action/EMCP_WB_Container.set | T4/T5 | net-api-handler |
| mcp:handler-action/EMCP_WB_Diag.catalog | T3/T5 | candidate: net-api-handler |
| mcp:handler-action/EMCP_WB_Diag.get | T3/T5 | candidate: net-api-handler |
| mcp:handler-action/EMCP_WB_Diag.select | T3/T5 | candidate: net-api-handler |
| mcp:handler-action/EMCP_WB_Diag.set | T3/T5 | candidate: net-api-handler |
| mcp:handler-action/EMCP_WB_Info.run | T2/T5 | candidate: net-api-handler |
| mcp:handler-action/EMCP_WB_Meta.assignMaterial | T2/T5 | candidate: net-api-handler |
| mcp:handler-action/EMCP_WB_Plugin.describe | T3/T5 | candidate: net-api-handler |
| mcp:handler-action/EMCP_WB_Plugin.getSettings | T3/T5 | candidate: net-api-handler |
| mcp:handler-action/EMCP_WB_Plugin.list | T3/T5 | candidate: net-api-handler |
| mcp:handler-action/EMCP_WB_Plugin.run | T3/T5 | candidate: net-api-handler |
| mcp:handler-action/EMCP_WB_Plugin.setSettings | T3/T5 | candidate: net-api-handler |
| mcp:handler-action/EMCP_WB_Reload.run | T2/T5 | candidate: net-api-handler |
| mcp:handler-action/EMCP_WB_Resources.search | T2/T5 | candidate: net-api-handler |
| mcp:handler-action/EMCP_WB_Resources.selection | T2/T5 | candidate: net-api-handler |

## Dispositions (0)

No row of this module carries a disposition.
