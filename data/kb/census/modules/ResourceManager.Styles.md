# Census: ResourceManager.Styles

83 rows (0 aggregate excluded).

## What it is

Module ResourceManager.Styles: file 1, schema 16, ui 66. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- file-type .styles (file:.styles): Defines UI style
- schema-class WSItem (schema:WSItem): 3116 instances in 6 .styles files of the 1.9.0.37 paks; nested
- schema-class WSState (schema:WSState): 246 instances in 6 .styles files of the 1.9.0.37 paks; nested
- schema-class WSStyle (schema:WSStyle): 114 instances in 6 .styles files of the 1.9.0.37 paks; nested
- schema-class WSWidget (schema:WSWidget): 83 instances in 6 .styles files of the 1.9.0.37 paks; root and nested
- schema-class WSWidgetStyle (schema:WSWidgetStyle): 2 instances in 2 .styles files of the 1.9.0.37 paks; root
- panel ImageSet Groups (ui:ResourceManager.Styles/panel/#groupBox_3)
- panel Image Picker (ui:ResourceManager.Styles/panel/#previewImageSet)
- panel Style Preview (ui:ResourceManager.Styles/panel/#previewWidget)
- panel Details (ui:ResourceManager.Styles/panel/#qt_tabwidget_tabbar)
- panel Image Picker (ui:ResourceManager.Styles/panel/Image Picker)
- panel States (ui:ResourceManager.Styles/panel/States)
- ... 2 more

Hand page: [Styles Editor](../hand/StylesEditor.md)

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| file | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| schema | 0 | 0 | 16 | 0 | 0 | 0 | 16 |
| ui | 34 | 4 | 28 | 0 | 0 | 0 | 66 |

## By kind

- control: 42
- file-type: 1
- menu: 1
- panel: 8
- region: 12
- schema-class: 5
- schema-key: 11
- tab: 3

## By risk

- mutating: 42
- safe: 41

## Rows by kind

### control (42)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Styles/control/#addStyleButton | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/#addWidgetButton | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/#clearButton | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/#fontButton | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/#fontEdit | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/#groupsTree | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/#imageSetButton | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/#imageSetEdit | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/#nameEdit | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/#removeStyleButton | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/#removeWidgetButton | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/#statesTree | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/@QPushButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Resource Variants | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.10 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.11 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.12 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.13 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.14 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.15 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.16 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.17 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.18 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.2 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.3 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.4 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.5 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.6 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.7 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.8 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.9 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/ButtonWidget | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/EditBoxWidget | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/GenericListboxWidget | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/MultilineEditBoxWidget | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/ProgressBarWidget | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/RichTextWidget | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/TextListboxWidget | T2/T5 | candidate: gui-automation | none |

2 more: wb_census find with module=ResourceManager.Styles kind=control.

### file-type (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| file:.styles | T2/T3 | candidate: file-format | [find_broken_refs.run](../tools/find_broken_refs.md) read, [find_references.run](../tools/find_references.md) read, [find_unused_resources.run](../tools/find_unused_resources.md) read, [inheritance_chain.run](../tools/inheritance_chain.md) read, [list_resources.run](../tools/list_resources.md) read, [project_index_status.run](../tools/project_index_status.md) read, [refactor_remove_unused.run](../tools/refactor_remove_unused.md) read, [resolve_guid.run](../tools/resolve_guid.md) read, [ui_layout_validate.run](../tools/ui_layout_validate.md) read, [ui_styles_inspect.run](../tools/ui_styles_inspect.md) read |

### menu (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Styles/menu/WidgetStyle | T1/T3 | candidate: gui-automation | none |

### panel (8)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Styles/panel/#groupBox_3 | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/panel/#previewImageSet | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/panel/#previewWidget | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/panel/#qt_tabwidget_tabbar | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/panel/Image Picker | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/panel/States | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/panel/Style Preview | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/panel/Widget Style | T2/T3 | candidate: gui-automation | none |

### region (12)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Styles/region/#WidgetStyleEditorDetails | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/region/#WidgetStyleEditorPreview | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/region/@QSplitterHandle.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/region/@QSplitterHandle.2 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/region/@QSplitterHandle.3 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/region/@QSplitterHandle.4 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/region/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/region/States/statesTree/@Header.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/region/States/statesTree/@Header.2 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/region/Widget Style/@QTreeWidget.1/@Header.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/region/Widget Style/@QTreeWidget.1/@Header.2 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/region/Widget Style/@QTreeWidget.1/@Header.3 | T0/T2 | candidate: gui-automation | none |

### schema-class (5)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:WSItem | T2/T2 | candidate: file-format | none |
| schema:WSState | T2/T2 | candidate: file-format | none |
| schema:WSStyle | T2/T2 | candidate: file-format | none |
| schema:WSWidget | T2/T2 | candidate: file-format | none |
| schema:WSWidgetStyle | T2/T2 | candidate: file-format | none |

### schema-key (11)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:WSItem.Image | T2/T2 | candidate: file-format | none |
| schema:WSItem.Name | T2/T2 | candidate: file-format | none |
| schema:WSState.Items | T2/T2 | candidate: file-format | none |
| schema:WSState.Name | T2/T2 | candidate: file-format | none |
| schema:WSStyle.Font | T2/T2 | candidate: file-format | none |
| schema:WSStyle.ImageSet | T2/T2 | candidate: file-format | none |
| schema:WSStyle.Name | T2/T2 | candidate: file-format | none |
| schema:WSStyle.States | T2/T2 | candidate: file-format | none |
| schema:WSWidget.Name | T2/T2 | candidate: file-format | none |
| schema:WSWidget.Styles | T2/T2 | candidate: file-format | none |
| schema:WSWidgetStyle.Widgets | T2/T2 | candidate: file-format | none |

### tab (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Styles/tab/#DockingTabBar | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/tab/qt_tabwidget_tabbar/Details | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Styles/tab/qt_tabwidget_tabbar/Import Settings | T1/T3 | candidate: gui-automation | none |

## Below target (67)

- T0 to T2: 12
- T0 to T5: 22
- T1 to T3: 4
- T2 to T3: 9
- T2 to T5: 20

| id | tier | path |
| --- | --- | --- |
| file:.styles | T2/T3 | candidate: file-format |
| ui:ResourceManager.Styles/control/#addStyleButton | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/#addWidgetButton | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/#clearButton | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/#fontButton | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/#fontEdit | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/#groupsTree | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/#imageSetButton | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/#imageSetEdit | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/#nameEdit | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/#removeStyleButton | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/#removeWidgetButton | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/#statesTree | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/@QPushButton.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Resource Variants | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.10 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.11 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.12 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.13 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.14 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.15 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.16 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.17 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.18 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.2 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.3 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.4 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.5 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.6 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.7 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.8 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/@TreeItem.9 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/ButtonWidget | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/EditBoxWidget | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/GenericListboxWidget | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/MultilineEditBoxWidget | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/ProgressBarWidget | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/RichTextWidget | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/TextListboxWidget | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/TextWidget | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/WindowWidget | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Styles/menu/WidgetStyle | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Styles/panel/#groupBox_3 | T2/T3 | candidate: gui-automation |
| ui:ResourceManager.Styles/panel/#previewImageSet | T2/T3 | candidate: gui-automation |
| ui:ResourceManager.Styles/panel/#previewWidget | T2/T3 | candidate: gui-automation |
| ui:ResourceManager.Styles/panel/#qt_tabwidget_tabbar | T2/T3 | candidate: gui-automation |
| ui:ResourceManager.Styles/panel/Image Picker | T2/T3 | candidate: gui-automation |
| ui:ResourceManager.Styles/panel/States | T2/T3 | candidate: gui-automation |
| ui:ResourceManager.Styles/panel/Style Preview | T2/T3 | candidate: gui-automation |
| ui:ResourceManager.Styles/panel/Widget Style | T2/T3 | candidate: gui-automation |
| ui:ResourceManager.Styles/region/#WidgetStyleEditorDetails | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Styles/region/#WidgetStyleEditorPreview | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Styles/region/@QSplitterHandle.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Styles/region/@QSplitterHandle.2 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Styles/region/@QSplitterHandle.3 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Styles/region/@QSplitterHandle.4 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Styles/region/@QWidget.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Styles/region/States/statesTree/@Header.1 | T0/T2 | candidate: gui-automation |

7 more: wb_census find with module=ResourceManager.Styles.

## Dispositions (0)

No row of this module carries a disposition.
