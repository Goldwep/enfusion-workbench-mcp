# Census: no module, kind window

5 rows (1 aggregate excluded).

## What it is

Module none: ui 5. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- window AudioFileProfilerWindow (ui:none/window/AudioFileProfilerWindow)
- window ConvertAudioFileWindow (ui:none/window/ConvertAudioFileWindow)
- window DialogueSentenceEditorWidget (ui:none/window/DialogueSentenceEditorWidget)
- window QtIntrospectionTool (ui:none/window/QtIntrospectionTool)
- window TabbedWindow (ui:none/window/TabbedWindow)

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ui | 5 | 0 | 0 | 0 | 0 | 0 | 5 |

## By kind

- window: 5

## By risk

- safe: 5

## Rows by kind

### window (5)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:none/window/AudioFileProfilerWindow | T0/T3 | candidate: gui-automation | none |
| ui:none/window/ConvertAudioFileWindow | T0/T3 | candidate: gui-automation | none |
| ui:none/window/DialogueSentenceEditorWidget | T0/T3 | candidate: gui-automation | none |
| ui:none/window/QtIntrospectionTool | T0/T3 | candidate: gui-automation | none |
| ui:none/window/TabbedWindow | T0/T3 | candidate: gui-automation | none |

## Below target (5)

- T0 to T3: 5

| id | tier | path |
| --- | --- | --- |
| ui:none/window/AudioFileProfilerWindow | T0/T3 | candidate: gui-automation |
| ui:none/window/ConvertAudioFileWindow | T0/T3 | candidate: gui-automation |
| ui:none/window/DialogueSentenceEditorWidget | T0/T3 | candidate: gui-automation |
| ui:none/window/QtIntrospectionTool | T0/T3 | candidate: gui-automation |
| ui:none/window/TabbedWindow | T0/T3 | candidate: gui-automation |

## Dispositions (1)

| id | kind | why | evidence |
| --- | --- | --- | --- |
| ui:none/window/QtIntrospectionTool | blocked | blocked:P-W8-20 (Qt Introspection Tool, U31: present and what it lists) (DEC-087 ruling 3) | EV-P6-BK2-003 |
