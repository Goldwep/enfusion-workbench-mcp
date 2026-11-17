# Census: ResourceManager.Material

65 rows (2 aggregate excluded).

## What it is

Module ResourceManager.Material: api 5, ui 60. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- panel Details (ui:ResourceManager.Material/panel/#qt_tabwidget_tabbar)
- window Font Viewer (.fnt, .ttf) (ui:ResourceManager.Material/window/Font Viewer (.fnt, .ttf)): Font preview; no wiki page in the dump
- window Material Editor (.emat) UI (ui:ResourceManager.Material/window/Material Editor (.emat) UI): Property grid + preview for a material; the wiki page is a TODO placeholder
- window Prefab preview (.et) in RM (ui:ResourceManager.Material/window/Prefab preview (.et) in RM): Opens a prefab tab with an "Edit prefab" action
- window Ragdoll (.ragdoll) (ui:ResourceManager.Material/window/Ragdoll (.ragdoll)): "No preview at the moment"
- window Styles Editor (.styles) (ui:ResourceManager.Material/window/Styles Editor (.styles)): Widget style editor; no wiki page in the dump

Hand page: [Material Editor](../hand/MaterialEditor.md)

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| api | 5 | 0 | 0 | 0 | 0 | 0 | 5 |
| ui | 16 | 13 | 31 | 0 | 0 | 0 | 60 |

## By kind

- control: 8
- method: 5
- panel: 1
- property-group: 6
- region: 8
- tab: 3
- toolbar: 2
- toolbar-button: 27
- window: 5

## By risk

- mutating: 40
- safe: 25

## Rows by kind

### control (8)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Material/control/@QPushButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Material/control/@QPushButton.2 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Material/control/@QPushButton.3 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Material/control/@WBEditBox.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Material/control/@WBEditBox.1/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Material/control/Change Class | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Material/control/Parent Material | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Material/control/Resource Variants | T2/T5 | candidate: gui-automation | none |

### method (5)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:method/Diff materials | T0/T5 | candidate: file-format | [material_diff.run](../tools/material_diff.md) read |
| api:method/Game materials list | T0/T5 | candidate: builtin-net-handler | none |
| api:method/Material validation rules | T0/T5 | candidate: builtin-net-handler, net-api-handler | none |
| api:method/Read material | T0/T5 | candidate: builtin-net-handler, file-format | none |
| api:method/Unused textures | T0/T5 | candidate: file-format | [material_find_unused_textures.run](../tools/material_find_unused_textures.md) read |

### panel (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Material/panel/#qt_tabwidget_tabbar | T2/T3 | candidate: gui-automation | none |

### property-group (6)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Material/property-group/@PropertyGridBC.1 | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Material/property-group/@PropertyGridBC.1/Basic material maps and its modifiers | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Material/property-group/@PropertyGridBC.1/Global MCR Map | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Material/property-group/@PropertyGridBC.1/Global NMO Map | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Material/property-group/@PropertyGridBC.1/Mask Map | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Material/property-group/@PropertyGridBC.1/VFX Map | T1/T3 | candidate: gui-automation | none |

### region (8)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Material/region/@QLabel.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Material/region/@QLabel.2 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Material/region/@QSplitterHandle.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Material/region/@QToolBar.1/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Material/region/@QToolBar.1/@QWidget.2 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Material/region/@QToolBar.2/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Material/region/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Material/region/@SceneRenderWindow.1 | T0/T2 | candidate: gui-automation | none |

### tab (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Material/tab/#DockingTabBar | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Material/tab/qt_tabwidget_tabbar/Details | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Material/tab/qt_tabwidget_tabbar/Import Settings | T1/T3 | candidate: gui-automation | none |

### toolbar (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Material/toolbar/@QToolBar.1 | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Material/toolbar/@QToolBar.2 | T0/T3 | candidate: gui-automation | none |

### toolbar-button (27)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/BSP | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Background color | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Box model | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Change FOV | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Colliders | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Custom model | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/EV Minus | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/EV Plus | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Lock EV | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Move | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/PBR Shape model | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Plane model | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Position to ground | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Reset entity rotations | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Reset model bones transformations to init state | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Rotate | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Show bones | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Show grid | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Show volumetric info | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Sphere model | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Toggle Gizmo Space | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Turn camera to POI on mouse wheel | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Visibility occlusion | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.2/Options | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.2/Overlay | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.2/Shading | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.2/View | T2/T5 | candidate: execute-action, gui-automation | none |

### window (5)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Material/window/Font Viewer (.fnt, .ttf) | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Material/window/Material Editor (.emat) UI | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Material/window/Prefab preview (.et) in RM | T1/T3 | candidate: net-api-handler | none |
| ui:ResourceManager.Material/window/Ragdoll (.ragdoll) | T1/T3 | candidate: file-format | none |
| ui:ResourceManager.Material/window/Styles Editor (.styles) | T1/T3 | candidate: file-format, gui-automation | none |

## Below target (65)

- T0 to T2: 8
- T0 to T3: 3
- T0 to T5: 10
- T1 to T3: 13
- T2 to T3: 1
- T2 to T5: 30

| id | tier | path |
| --- | --- | --- |
| api:method/Diff materials | T0/T5 | candidate: file-format |
| api:method/Game materials list | T0/T5 | candidate: builtin-net-handler |
| api:method/Material validation rules | T0/T5 | candidate: builtin-net-handler, net-api-handler |
| api:method/Read material | T0/T5 | candidate: builtin-net-handler, file-format |
| api:method/Unused textures | T0/T5 | candidate: file-format |
| ui:ResourceManager.Material/control/@QPushButton.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Material/control/@QPushButton.2 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Material/control/@QPushButton.3 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Material/control/@WBEditBox.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Material/control/@WBEditBox.1/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Material/control/Change Class | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Material/control/Parent Material | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Material/control/Resource Variants | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Material/panel/#qt_tabwidget_tabbar | T2/T3 | candidate: gui-automation |
| ui:ResourceManager.Material/property-group/@PropertyGridBC.1 | T0/T3 | candidate: gui-automation |
| ui:ResourceManager.Material/property-group/@PropertyGridBC.1/Basic material maps and its modifiers | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Material/property-group/@PropertyGridBC.1/Global MCR Map | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Material/property-group/@PropertyGridBC.1/Global NMO Map | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Material/property-group/@PropertyGridBC.1/Mask Map | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Material/property-group/@PropertyGridBC.1/VFX Map | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Material/region/@QLabel.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Material/region/@QLabel.2 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Material/region/@QSplitterHandle.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Material/region/@QToolBar.1/@QWidget.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Material/region/@QToolBar.1/@QWidget.2 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Material/region/@QToolBar.2/@QWidget.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Material/region/@QWidget.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Material/region/@SceneRenderWindow.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Material/tab/#DockingTabBar | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Material/tab/qt_tabwidget_tabbar/Details | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Material/tab/qt_tabwidget_tabbar/Import Settings | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/BSP | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Background color | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Box model | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Change FOV | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Colliders | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Custom model | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/EV Minus | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/EV Plus | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Lock EV | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Move | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/PBR Shape model | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Plane model | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Position to ground | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Reset entity rotations | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Reset model bones transformations to init state | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Rotate | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Show bones | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Show grid | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Show volumetric info | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Sphere model | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Toggle Gizmo Space | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Turn camera to POI on mouse wheel | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Visibility occlusion | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.2/Options | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.2/Overlay | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.2/Shading | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar-button/@QToolBar.2/View | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Material/toolbar/@QToolBar.1 | T0/T3 | candidate: gui-automation |
| ui:ResourceManager.Material/toolbar/@QToolBar.2 | T0/T3 | candidate: gui-automation |

5 more: wb_census find with module=ResourceManager.Material.

## Dispositions (0)

No row of this module carries a disposition.
