# Census: ResourceManager.Texture

76 rows (2 aggregate excluded).

## What it is

Module ResourceManager.Texture: api 1, file 1, plugin 1, ui 73. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- file-type .edds (file:.edds): Enfusion proprietary (extended) compressed DDS texture
- panel Details (ui:ResourceManager.Texture/panel/#qt_tabwidget_tabbar)
- panel Details: Histogram + colour graph + Reset (ui:ResourceManager.Texture/panel/Details: Histogram + colour graph + Reset): Pixel count, per-channel stats, zoomable graph
- panel Details: Texture properties (ui:ResourceManager.Texture/panel/Details: Texture properties): File size, surface size, image format, data format, mipmaps, width, height, depth, alpha present, black and white, last pixel (px, 0..1, colour)
- panel Import Settings tab (ui:ResourceManager.Texture/panel/Import Settings tab): See section 2.10 (about 22 properties)
- window Open texture (ui:ResourceManager.Texture/window/Open texture): 2D viewer

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| api | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| file | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| plugin | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| ui | 34 | 23 | 16 | 0 | 0 | 0 | 73 |

## By kind

- control: 14
- file-type: 1
- method: 1
- panel: 4
- plugin: 1
- property-group: 3
- region: 14
- tab: 5
- tool: 1
- toolbar: 3
- toolbar-button: 28
- window: 1

## By risk

- mutating: 45
- safe: 31

## Rows by kind

### control (14)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Texture/control/@QPushButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/control/@QToolBar.1/@QCheckBox.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/control/@QToolBar.1/@QComboBox.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/control/@QToolBar.1/@QComboBox.2 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/control/@QToolBar.1/@QComboBox.3 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/control/@QToolBar.1/@QComboBox.4 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/control/@QToolBar.2/@QLineEdit.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/control/Reset | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/control/Toolbar: Brightness | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/control/Toolbar: Color scheme | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/control/Toolbar: Filtering mode | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/control/Toolbar: Lock settings | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/control/Toolbar: Preview background | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/control/Toolbar: Show alpha mask | T0/T5 | candidate: gui-automation | none |

### file-type (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| file:.edds | T2/T3 | candidate: file-format | [asset_orphan_scan.run](../tools/asset_orphan_scan.md) read, [asset_search.run](../tools/asset_search.md) read, [material_find_unused_textures.run](../tools/material_find_unused_textures.md) read |

### method (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:method/Texture validation | T0/T5 | candidate: builtin-net-handler | none |

### panel (4)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Texture/panel/#qt_tabwidget_tabbar | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/panel/Details: Histogram + colour graph + Reset | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/panel/Details: Texture properties | T0/T3 | candidate: file-format, gui-automation | none |
| ui:ResourceManager.Texture/panel/Import Settings tab | T0/T3 | candidate: file-format, net-api-handler | none |

### plugin (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:plugin/Batch texture processor plugin | T0/T5 | candidate: net-api-handler, plugin-run | none |

### property-group (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Texture/property-group/@PropertyGrid.1 | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/property-group/@PropertyGrid.1/Histogram | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/property-group/@PropertyGrid.1/Texture properties (read only) | T1/T3 | candidate: gui-automation | none |

### region (14)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Texture/region/@HistogramWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/region/@QSplitterHandle.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/region/@QToolBar.1/@QToolBarSeparator.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/region/@QToolBar.1/@QToolBarSeparator.2 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/region/@QToolBar.1/@QToolBarSeparator.3 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/region/@QToolBar.1/@QToolBarSeparator.4 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/region/@QToolBar.1/@QToolBarSeparator.5 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/region/@QToolBar.1/@QToolBarSeparator.6 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/region/@QToolBar.1/@QToolBarSeparator.7 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/region/@QToolBar.2/@ColorInput.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/region/@QToolBar.2/@QToolBarSeparator.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/region/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/region/@QWidget.2 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/region/@TexturePreviewWindow.1 | T0/T2 | candidate: gui-automation | none |

### tab (5)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Texture/tab/#DockingTabBar | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/tab/Details Tab | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/tab/Import Settings Tab | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/tab/qt_tabwidget_tabbar/Details | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/tab/qt_tabwidget_tabbar/Import Settings | T1/T3 | candidate: gui-automation | none |

### tool (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Texture/tool/Toolbar: Pick colour | T0/T5 | candidate: gui-automation | none |

### toolbar (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Texture/toolbar/@QToolBar.1 | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/toolbar/@QToolBar.2 | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Texture/toolbar/Horizontal Bar | T1/T3 | candidate: gui-automation | none |

### toolbar-button (28)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Alpha channel | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Blue channel | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Enable border on seams | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Enable tiling | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Green channel | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Lock texture settings | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Pick color to clipboard | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/RGB | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Red channel | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Show alpha mask | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Use black color in preview | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Use checker board pattern in preview | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Use gray color in preview | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Use white color in preview | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/Auto scale to fit | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/Brightness | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/Color scheme | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/Depth | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/Filtering mode | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/Filtering mode/Bilinear | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/Filtering mode/Point filter | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/Filtering mode/Trilinear | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/Filtering mode/Trilinear/mip level | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/Lock texture settings | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/Pick color to clipboard | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/Preview background | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/Show alpha mask | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Texture/toolbar-button/Toggle%2FIsolate channel | T1/T5 | candidate: execute-action, gui-automation | none |

### window (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Texture/window/Open texture | T1/T3 | candidate: net-api-handler | none |

## Below target (76)

- T0 to T2: 14
- T0 to T3: 6
- T0 to T5: 16
- T1 to T3: 9
- T1 to T5: 14
- T2 to T3: 2
- T2 to T5: 15

| id | tier | path |
| --- | --- | --- |
| api:method/Texture validation | T0/T5 | candidate: builtin-net-handler |
| file:.edds | T2/T3 | candidate: file-format |
| plugin:plugin/Batch texture processor plugin | T0/T5 | candidate: net-api-handler, plugin-run |
| ui:ResourceManager.Texture/control/@QPushButton.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Texture/control/@QToolBar.1/@QCheckBox.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Texture/control/@QToolBar.1/@QComboBox.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Texture/control/@QToolBar.1/@QComboBox.2 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Texture/control/@QToolBar.1/@QComboBox.3 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Texture/control/@QToolBar.1/@QComboBox.4 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Texture/control/@QToolBar.2/@QLineEdit.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Texture/control/Reset | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Texture/control/Toolbar: Brightness | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Texture/control/Toolbar: Color scheme | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Texture/control/Toolbar: Filtering mode | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Texture/control/Toolbar: Lock settings | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Texture/control/Toolbar: Preview background | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Texture/control/Toolbar: Show alpha mask | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Texture/panel/#qt_tabwidget_tabbar | T2/T3 | candidate: gui-automation |
| ui:ResourceManager.Texture/panel/Details: Histogram + colour graph + Reset | T0/T3 | candidate: gui-automation |
| ui:ResourceManager.Texture/panel/Details: Texture properties | T0/T3 | candidate: file-format, gui-automation |
| ui:ResourceManager.Texture/panel/Import Settings tab | T0/T3 | candidate: file-format, net-api-handler |
| ui:ResourceManager.Texture/property-group/@PropertyGrid.1 | T0/T3 | candidate: gui-automation |
| ui:ResourceManager.Texture/property-group/@PropertyGrid.1/Histogram | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Texture/property-group/@PropertyGrid.1/Texture properties (read only) | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Texture/region/@HistogramWidget.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Texture/region/@QSplitterHandle.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Texture/region/@QToolBar.1/@QToolBarSeparator.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Texture/region/@QToolBar.1/@QToolBarSeparator.2 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Texture/region/@QToolBar.1/@QToolBarSeparator.3 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Texture/region/@QToolBar.1/@QToolBarSeparator.4 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Texture/region/@QToolBar.1/@QToolBarSeparator.5 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Texture/region/@QToolBar.1/@QToolBarSeparator.6 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Texture/region/@QToolBar.1/@QToolBarSeparator.7 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Texture/region/@QToolBar.2/@ColorInput.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Texture/region/@QToolBar.2/@QToolBarSeparator.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Texture/region/@QWidget.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Texture/region/@QWidget.2 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Texture/region/@TexturePreviewWindow.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Texture/tab/#DockingTabBar | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Texture/tab/Details Tab | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Texture/tab/Import Settings Tab | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Texture/tab/qt_tabwidget_tabbar/Details | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Texture/tab/qt_tabwidget_tabbar/Import Settings | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Texture/tool/Toolbar: Pick colour | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Alpha channel | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Blue channel | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Enable border on seams | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Enable tiling | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Green channel | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Lock texture settings | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Pick color to clipboard | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/RGB | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Red channel | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Show alpha mask | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Use black color in preview | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Use checker board pattern in preview | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Use gray color in preview | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Texture/toolbar-button/@QToolBar.1/Use white color in preview | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Texture/toolbar-button/Auto scale to fit | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Texture/toolbar-button/Brightness | T1/T5 | candidate: execute-action, gui-automation |

16 more: wb_census find with module=ResourceManager.Texture.

## Dispositions (0)

No row of this module carries a disposition.
