# Census: Launcher

28 rows (0 aggregate excluded).

## What it is

Module Launcher: setting 12, ui 16. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- window Enfusion Workbench Launcher (ui:Launcher/window/Enfusion Workbench Launcher)

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| setting | 12 | 0 | 0 | 0 | 0 | 0 | 12 |
| ui | 3 | 10 | 3 | 0 | 0 | 0 | 16 |

## By kind

- control: 14
- dialog: 1
- option: 2
- setting-key: 10
- window: 1

## By risk

- mutating: 22
- safe: 6

## Rows by kind

### control (14)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:Launcher/control/Add Existing | T1/T5 | candidate: gui-automation | none |
| ui:Launcher/control/Add Project | T1/T5 | candidate: gui-automation | none |
| ui:Launcher/control/Create New | T1/T5 | candidate: gui-automation | none |
| ui:Launcher/control/Enfusion Workbench Launcher/@QListWidget.1 | T0/T5 | candidate: gui-automation | none |
| ui:Launcher/control/Enfusion Workbench Launcher/@QToolButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:Launcher/control/Enfusion Workbench Launcher/Add Project | T2/T5 | candidate: gui-automation | none |
| ui:Launcher/control/Enfusion Workbench Launcher/Open | T2/T5 | candidate: gui-automation | none |
| ui:Launcher/control/Enfusion Workbench Launcher/Projects | T2/T5 | candidate: gui-automation | none |
| ui:Launcher/control/Enfusion Workbench Launcher/Projects/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:Launcher/control/Project Creation/Dependencies | T1/T5 | candidate: gui-automation | none |
| ui:Launcher/control/Project Creation/OK | T1/T5 | candidate: gui-automation | none |
| ui:Launcher/control/Project Creation/project's location | T1/T5 | candidate: gui-automation | none |
| ui:Launcher/control/Project Creation/project's name | T1/T5 | candidate: gui-automation | none |
| ui:Launcher/control/Scan for Projects | T1/T5 | candidate: gui-automation | none |

### dialog (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:Launcher/dialog/Project Creation | T1/T3 | candidate: gui-automation | none |

### option (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| setting:Game Project Manager/CheckSvnOnOpen | T0/T5 | candidate: file-format, gui-automation | none |
| setting:Game Project Manager/ListViewMode | T0/T5 | candidate: file-format, gui-automation | none |

### setting-key (10)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| setting:Game Project Manager%2FAddonPresets/Preset 1 | T0/T3 | candidate: file-format | none |
| setting:Game Project Manager%2FAddonPresets/Preset 2 | T0/T3 | candidate: file-format | none |
| setting:Game Project Manager%2FAddonPresets/Preset 3 | T0/T3 | candidate: file-format | none |
| setting:Game Project Manager%2FAddonPresets/Preset 4 | T0/T3 | candidate: file-format | none |
| setting:Game Project Manager%2FAddonPresets/Preset 5 | T0/T3 | candidate: file-format | none |
| setting:Game Project Manager%2FAddonPresets/Preset 6 | T0/T3 | candidate: file-format | none |
| setting:Game Project Manager%2FAddonPresets/Preset 7 | T0/T3 | candidate: file-format | none |
| setting:Game Project Manager%2FAddonPresets/Preset 8 | T0/T3 | candidate: file-format | none |
| setting:Game Project Manager/Geometry | T0/T3 | candidate: file-format | none |
| setting:Game Project Manager/LastOpenAddonLocation | T0/T3 | candidate: file-format | none |

### window (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:Launcher/window/Enfusion Workbench Launcher | T1/T3 | candidate: gui-automation | none |

## Below target (28)

- T0 to T3: 10
- T0 to T5: 5
- T1 to T3: 2
- T1 to T5: 8
- T2 to T5: 3

| id | tier | path |
| --- | --- | --- |
| setting:Game Project Manager%2FAddonPresets/Preset 1 | T0/T3 | candidate: file-format |
| setting:Game Project Manager%2FAddonPresets/Preset 2 | T0/T3 | candidate: file-format |
| setting:Game Project Manager%2FAddonPresets/Preset 3 | T0/T3 | candidate: file-format |
| setting:Game Project Manager%2FAddonPresets/Preset 4 | T0/T3 | candidate: file-format |
| setting:Game Project Manager%2FAddonPresets/Preset 5 | T0/T3 | candidate: file-format |
| setting:Game Project Manager%2FAddonPresets/Preset 6 | T0/T3 | candidate: file-format |
| setting:Game Project Manager%2FAddonPresets/Preset 7 | T0/T3 | candidate: file-format |
| setting:Game Project Manager%2FAddonPresets/Preset 8 | T0/T3 | candidate: file-format |
| setting:Game Project Manager/CheckSvnOnOpen | T0/T5 | candidate: file-format, gui-automation |
| setting:Game Project Manager/Geometry | T0/T3 | candidate: file-format |
| setting:Game Project Manager/LastOpenAddonLocation | T0/T3 | candidate: file-format |
| setting:Game Project Manager/ListViewMode | T0/T5 | candidate: file-format, gui-automation |
| ui:Launcher/control/Add Existing | T1/T5 | candidate: gui-automation |
| ui:Launcher/control/Add Project | T1/T5 | candidate: gui-automation |
| ui:Launcher/control/Create New | T1/T5 | candidate: gui-automation |
| ui:Launcher/control/Enfusion Workbench Launcher/@QListWidget.1 | T0/T5 | candidate: gui-automation |
| ui:Launcher/control/Enfusion Workbench Launcher/@QToolButton.1 | T0/T5 | candidate: gui-automation |
| ui:Launcher/control/Enfusion Workbench Launcher/Add Project | T2/T5 | candidate: gui-automation |
| ui:Launcher/control/Enfusion Workbench Launcher/Open | T2/T5 | candidate: gui-automation |
| ui:Launcher/control/Enfusion Workbench Launcher/Projects | T2/T5 | candidate: gui-automation |
| ui:Launcher/control/Enfusion Workbench Launcher/Projects/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation |
| ui:Launcher/control/Project Creation/Dependencies | T1/T5 | candidate: gui-automation |
| ui:Launcher/control/Project Creation/OK | T1/T5 | candidate: gui-automation |
| ui:Launcher/control/Project Creation/project's location | T1/T5 | candidate: gui-automation |
| ui:Launcher/control/Project Creation/project's name | T1/T5 | candidate: gui-automation |
| ui:Launcher/control/Scan for Projects | T1/T5 | candidate: gui-automation |
| ui:Launcher/dialog/Project Creation | T1/T3 | candidate: gui-automation |
| ui:Launcher/window/Enfusion Workbench Launcher | T1/T3 | candidate: gui-automation |

## Dispositions (0)

No row of this module carries a disposition.
