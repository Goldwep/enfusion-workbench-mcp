# Census: no module, kind class

3 rows (0 aggregate excluded).

## What it is

Module none: api 3. Seen in builds 1.8.0.13 to 1.8.0.13.

Surfaces:

- class ScriptEditorPlugin (api:ScriptEditorPlugin): There is no such class in either index or in any of 6,568 game scripts; Script Editor plugins derive from WorkbenchPlugin with wbModules: { "ScriptEditor" }. KB workbench-plugins.md shows class TAG_MyScriptPlugin : ScriptEditorPlugin, which would not compile
- class SCR_OKWorkbenchDialog, SCR_OKCancelWorkbenchDialog (obsolete), SCR_TextResultWorkbenchDialog, SCR_ConfirmationDialogWorkbench (api:class/SCR_OKWorkbenchDialog, SCR_OKCancelWorkbenchDialog (obsolete), SCR_TextResultWorkbenchDialog, SCR_ConfirmationDialogWorkbench): Game-side dialog helpers; the text-result one has a "Copy to Clipboard" button
- class WorkbenchDialog_OKCancel, WorkbenchDialog_AbortRetryIgnore (api:class/WorkbenchDialog_OKCancel, WorkbenchDialog_AbortRetryIgnore): Ready-made ScriptDialog data objects (OK=1/Cancel=0; Abort=0/Retry=1/Ignore=2 in m_iResult)

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| api | 3 | 0 | 0 | 0 | 0 | 0 | 3 |

## By kind

- class: 3

## By risk

- safe: 3

## Rows by kind

### class (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:ScriptEditorPlugin | T0/T2 | candidate: none-known | none |
| api:class/SCR_OKWorkbenchDialog, SCR_OKCancelWorkbenchDialog (obsolete), SCR_TextResultWorkbenchDialog, SCR_ConfirmationDialogWorkbench | T0/T2 | candidate: gui-automation, net-api-handler | none |
| api:class/WorkbenchDialog_OKCancel, WorkbenchDialog_AbortRetryIgnore | T0/T2 | candidate: gui-automation, net-api-handler | none |

## Below target (3)

- T0 to T2: 3

| id | tier | path |
| --- | --- | --- |
| api:ScriptEditorPlugin | T0/T2 | candidate: none-known |
| api:class/SCR_OKWorkbenchDialog, SCR_OKCancelWorkbenchDialog (obsolete), SCR_TextResultWorkbenchDialog, SCR_ConfirmationDialogWorkbench | T0/T2 | candidate: gui-automation, net-api-handler |
| api:class/WorkbenchDialog_OKCancel, WorkbenchDialog_AbortRetryIgnore | T0/T2 | candidate: gui-automation, net-api-handler |

## Dispositions (3)

| id | kind | why | evidence |
| --- | --- | --- | --- |
| api:ScriptEditorPlugin | absent-in-build | G3 frontier: mirrors the recon_resolution absent-in-build already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/SCR_OKWorkbenchDialog, SCR_OKCancelWorkbenchDialog (obsolete), SCR_TextResultWorkbenchDialog, SCR_ConfirmationDialogWorkbench | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| api:class/WorkbenchDialog_OKCancel, WorkbenchDialog_AbortRetryIgnore | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
