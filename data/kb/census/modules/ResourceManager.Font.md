# Census: ResourceManager.Font

31 rows (0 aggregate excluded).

## What it is

Module ResourceManager.Font: file 1, ui 30. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- file-type .fnt (file:.fnt): Font for UI widget system, binary format
- panel Details (ui:ResourceManager.Font/panel/#qt_tabwidget_tabbar)

Hand page: [Font Viewer](../hand/FontViewer.md)

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| file | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| ui | 19 | 4 | 7 | 0 | 0 | 0 | 30 |

## By kind

- control: 13
- file-type: 1
- panel: 1
- property-group: 2
- region: 10
- tab: 3
- toolbar: 1

## By risk

- mutating: 13
- safe: 18

## Rows by kind

### control (13)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Font/control/@QPushButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Font/control/@QToolBar.1/@PropPushButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Font/control/@QToolBar.1/@PropPushButton.2 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Font/control/@QToolBar.1/@PropPushButton.3 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Font/control/@QToolBar.1/@QPushButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Font/control/@QToolBar.1/@QPushButton.2 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Font/control/@QToolBar.1/@QPushButton.3 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Font/control/@QToolBar.1/Offset: | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Font/control/@QToolBar.1/Outline: | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Font/control/@QToolBar.1/R | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Font/control/@QToolBar.1/Shadow: | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Font/control/@QToolBar.1/Size: | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Font/control/Check Characters | T2/T5 | candidate: gui-automation | none |

### file-type (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| file:.fnt | T2/T3 | candidate: file-format | none |

### panel (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Font/panel/#qt_tabwidget_tabbar | T2/T3 | candidate: gui-automation | none |

### property-group (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Font/property-group/#PropertyGrid | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Font/property-group/@PropertyGrid.1 | T0/T3 | candidate: gui-automation | none |

### region (10)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Font/region/@QSplitterHandle.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Font/region/@QToolBar.1/@QLabel.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Font/region/@QToolBar.1/@QToolBarSeparator.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Font/region/@QToolBar.1/@QToolBarSeparator.2 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Font/region/@QToolBar.1/@QToolBarSeparator.3 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Font/region/@QToolBar.1/@QToolBarSeparator.4 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Font/region/@QToolBar.1/@QToolBarSeparator.5 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Font/region/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Font/region/@QWidget.2 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Font/region/@WidgetsPreviewWindow.1 | T0/T2 | candidate: gui-automation | none |

### tab (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Font/tab/#DockingTabBar | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Font/tab/qt_tabwidget_tabbar/Details | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Font/tab/qt_tabwidget_tabbar/Import Settings | T1/T3 | candidate: gui-automation | none |

### toolbar (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Font/toolbar/@QToolBar.1 | T0/T3 | candidate: gui-automation | none |

## Below target (31)

- T0 to T2: 10
- T0 to T3: 2
- T0 to T5: 7
- T1 to T3: 4
- T2 to T3: 2
- T2 to T5: 6

| id | tier | path |
| --- | --- | --- |
| file:.fnt | T2/T3 | candidate: file-format |
| ui:ResourceManager.Font/control/@QPushButton.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Font/control/@QToolBar.1/@PropPushButton.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Font/control/@QToolBar.1/@PropPushButton.2 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Font/control/@QToolBar.1/@PropPushButton.3 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Font/control/@QToolBar.1/@QPushButton.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Font/control/@QToolBar.1/@QPushButton.2 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Font/control/@QToolBar.1/@QPushButton.3 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Font/control/@QToolBar.1/Offset: | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Font/control/@QToolBar.1/Outline: | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Font/control/@QToolBar.1/R | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Font/control/@QToolBar.1/Shadow: | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Font/control/@QToolBar.1/Size: | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Font/control/Check Characters | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Font/panel/#qt_tabwidget_tabbar | T2/T3 | candidate: gui-automation |
| ui:ResourceManager.Font/property-group/#PropertyGrid | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Font/property-group/@PropertyGrid.1 | T0/T3 | candidate: gui-automation |
| ui:ResourceManager.Font/region/@QSplitterHandle.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Font/region/@QToolBar.1/@QLabel.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Font/region/@QToolBar.1/@QToolBarSeparator.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Font/region/@QToolBar.1/@QToolBarSeparator.2 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Font/region/@QToolBar.1/@QToolBarSeparator.3 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Font/region/@QToolBar.1/@QToolBarSeparator.4 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Font/region/@QToolBar.1/@QToolBarSeparator.5 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Font/region/@QWidget.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Font/region/@QWidget.2 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Font/region/@WidgetsPreviewWindow.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Font/tab/#DockingTabBar | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Font/tab/qt_tabwidget_tabbar/Details | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Font/tab/qt_tabwidget_tabbar/Import Settings | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Font/toolbar/@QToolBar.1 | T0/T3 | candidate: gui-automation |

## Dispositions (1)

| id | kind | why | evidence |
| --- | --- | --- | --- |
| file:.fnt | blocked | blocked:P-W2-24 (BaseContainer text? then config_edit.read) (DEC-087 ruling 3) | EV-P6-BK2-003 |
