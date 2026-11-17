# Census: no module, kind net-function

14 rows (0 aggregate excluded).

## What it is

Module none: net 14. Seen in builds 1.8.0.13 to 1.9.0.37.

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| net | 7 | 0 | 4 | 3 | 0 | 0 | 14 |

## By kind

- net-function: 14

## By risk

- mutating: 12
- safe: 2

## Rows by kind

### net-function (14)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| net:native/BringModuleWindowToFront | T3/T5 | candidate: builtin-net-handler | [wb_module.front](../../tools/wb_module.md) drive |
| net:native/EvaluateScript | T2/T5 | candidate: builtin-net-handler | none |
| net:native/IsWorkbenchRunning | T2/T5 | candidate: builtin-net-handler | [wb_diagnose.run](../../tools/wb_diagnose.md) read, [wb_scripts.reload](../../tools/wb_scripts.md) read, [wb_scripts.status](../../tools/wb_scripts.md) read, [wb_scripts.validate](../../tools/wb_scripts.md) read, [wb_validate_scripts.run](../../tools/wb_validate_scripts.md) read |
| net:native/IsWorldEditorRunning | T3/T5 | candidate: builtin-net-handler | [wb_scripts.status](../../tools/wb_scripts.md) read |
| net:native/OpenResource | T3/T5 | candidate: builtin-net-handler | [wb_module.open](../../tools/wb_module.md) drive |
| net:native/ReloadScripts | T2/T5 | candidate: builtin-net-handler | [wb_scripts.reload](../../tools/wb_scripts.md) read |
| net:native/ValidateScripts | T2/T5 | candidate: builtin-net-handler | [wb_scripts.validate](../../tools/wb_scripts.md) read, [wb_validate_scripts.run](../../tools/wb_validate_scripts.md) read |
| net:net-function/Builtin NET API: BringModuleWindowToFront | T0/T5 | candidate: builtin-net-handler | none |
| net:net-function/Builtin NET API: EvaluateScript | T0/T5 | candidate: builtin-net-handler | none |
| net:net-function/Builtin NET API: IsWorkbenchRunning | T0/T5 | candidate: builtin-net-handler | none |
| net:net-function/Builtin NET API: IsWorldEditorRunning | T0/T5 | candidate: builtin-net-handler | none |
| net:net-function/Builtin NET API: OpenResource | T0/T5 | candidate: builtin-net-handler | none |
| net:net-function/Builtin NET API: ReloadScripts | T0/T5 | candidate: builtin-net-handler | none |
| net:net-function/Builtin NET API: ValidateScripts | T0/T5 | candidate: builtin-net-handler | none |

## Below target (14)

- T0 to T5: 7
- T2 to T5: 4
- T3 to T5: 3

| id | tier | path |
| --- | --- | --- |
| net:native/BringModuleWindowToFront | T3/T5 | candidate: builtin-net-handler |
| net:native/EvaluateScript | T2/T5 | candidate: builtin-net-handler |
| net:native/IsWorkbenchRunning | T2/T5 | candidate: builtin-net-handler |
| net:native/IsWorldEditorRunning | T3/T5 | candidate: builtin-net-handler |
| net:native/OpenResource | T3/T5 | candidate: builtin-net-handler |
| net:native/ReloadScripts | T2/T5 | candidate: builtin-net-handler |
| net:native/ValidateScripts | T2/T5 | candidate: builtin-net-handler |
| net:net-function/Builtin NET API: BringModuleWindowToFront | T0/T5 | candidate: builtin-net-handler |
| net:net-function/Builtin NET API: EvaluateScript | T0/T5 | candidate: builtin-net-handler |
| net:net-function/Builtin NET API: IsWorkbenchRunning | T0/T5 | candidate: builtin-net-handler |
| net:net-function/Builtin NET API: IsWorldEditorRunning | T0/T5 | candidate: builtin-net-handler |
| net:net-function/Builtin NET API: OpenResource | T0/T5 | candidate: builtin-net-handler |
| net:net-function/Builtin NET API: ReloadScripts | T0/T5 | candidate: builtin-net-handler |
| net:net-function/Builtin NET API: ValidateScripts | T0/T5 | candidate: builtin-net-handler |

## Dispositions (0)

No row of this module carries a disposition.
