# Census: DialogueEditor

19 rows (0 aggregate excluded).

## What it is

Module DialogueEditor: api 11, ui 8. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- class DialogueEditor (api:DialogueEditor)
- dock DebugControls (ui:DialogueEditor/dock/#DebugControls)
- dock NodePresetsDock (ui:DialogueEditor/dock/#NodePresetsDock)
- dock PreviewDock (ui:DialogueEditor/dock/#PreviewDock)
- dock ValidationErrorsDock (ui:DialogueEditor/dock/#ValidationErrorsDock)
- dock nodePropertiesDock (ui:DialogueEditor/dock/#nodePropertiesDock)
- dock scenePropertiesDock (ui:DialogueEditor/dock/#scenePropertiesDock)
- module ui:DialogueEditor/module/DialogueEditor (ui:DialogueEditor/module/DialogueEditor)

Hand page: [Dialogue Editor](../hand/DialogueEditor.md)

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| api | 6 | 0 | 5 | 0 | 0 | 0 | 11 |
| ui | 8 | 0 | 0 | 0 | 0 | 0 | 8 |

## By kind

- class: 1
- dock: 6
- method: 10
- module: 1
- toolbar: 1

## By risk

- mutating: 8
- safe: 11

## Rows by kind

### class (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:DialogueEditor | T2/T2 | candidate: none-known | none |

### dock (6)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:DialogueEditor/dock/#DebugControls | T0/T3 | candidate: gui-automation | none |
| ui:DialogueEditor/dock/#NodePresetsDock | T0/T3 | candidate: gui-automation | none |
| ui:DialogueEditor/dock/#PreviewDock | T0/T3 | candidate: gui-automation | none |
| ui:DialogueEditor/dock/#ValidationErrorsDock | T0/T3 | candidate: gui-automation | none |
| ui:DialogueEditor/dock/#nodePropertiesDock | T0/T3 | candidate: gui-automation | none |
| ui:DialogueEditor/dock/#scenePropertiesDock | T0/T3 | candidate: gui-automation | none |

### method (10)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:DialogueEditor.BeginEditAction/1 | T2/T5 | candidate: net-api-handler | none |
| api:DialogueEditor.EndEditAction/1 | T2/T5 | candidate: net-api-handler | none |
| api:DialogueEditor.GetCurrentDialogue/0 | T2/T5 | candidate: net-api-handler | none |
| api:DialogueEditor.GetCurrentNode/0 | T2/T5 | candidate: net-api-handler | none |
| api:method/Begin edit action | T0/T5 | candidate: net-api-handler | none |
| api:method/Container by index | T0/T5 | candidate: net-api-handler | none |
| api:method/Current dialogue | T0/T5 | candidate: net-api-handler | none |
| api:method/Current node | T0/T5 | candidate: net-api-handler | none |
| api:method/End edit action | T0/T5 | candidate: net-api-handler | none |
| api:method/Open a dialogue | T0/T5 | candidate: net-api-handler | none |

### module (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:DialogueEditor/module/DialogueEditor | T0/T5 | candidate: builtin-net-handler, net-api-handler | none |

### toolbar (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:DialogueEditor/toolbar/#mainToolbar | T0/T3 | candidate: gui-automation | none |

## Below target (18)

- T0 to T3: 7
- T0 to T5: 7
- T2 to T5: 4

| id | tier | path |
| --- | --- | --- |
| api:DialogueEditor.BeginEditAction/1 | T2/T5 | candidate: net-api-handler |
| api:DialogueEditor.EndEditAction/1 | T2/T5 | candidate: net-api-handler |
| api:DialogueEditor.GetCurrentDialogue/0 | T2/T5 | candidate: net-api-handler |
| api:DialogueEditor.GetCurrentNode/0 | T2/T5 | candidate: net-api-handler |
| api:method/Begin edit action | T0/T5 | candidate: net-api-handler |
| api:method/Container by index | T0/T5 | candidate: net-api-handler |
| api:method/Current dialogue | T0/T5 | candidate: net-api-handler |
| api:method/Current node | T0/T5 | candidate: net-api-handler |
| api:method/End edit action | T0/T5 | candidate: net-api-handler |
| api:method/Open a dialogue | T0/T5 | candidate: net-api-handler |
| ui:DialogueEditor/dock/#DebugControls | T0/T3 | candidate: gui-automation |
| ui:DialogueEditor/dock/#NodePresetsDock | T0/T3 | candidate: gui-automation |
| ui:DialogueEditor/dock/#PreviewDock | T0/T3 | candidate: gui-automation |
| ui:DialogueEditor/dock/#ValidationErrorsDock | T0/T3 | candidate: gui-automation |
| ui:DialogueEditor/dock/#nodePropertiesDock | T0/T3 | candidate: gui-automation |
| ui:DialogueEditor/dock/#scenePropertiesDock | T0/T3 | candidate: gui-automation |
| ui:DialogueEditor/module/DialogueEditor | T0/T5 | candidate: builtin-net-handler, net-api-handler |
| ui:DialogueEditor/toolbar/#mainToolbar | T0/T3 | candidate: gui-automation |

## Dispositions (0)

No row of this module carries a disposition.
