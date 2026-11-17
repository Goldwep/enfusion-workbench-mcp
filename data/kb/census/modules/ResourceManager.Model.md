# Census: ResourceManager.Model

97 rows (6 aggregate excluded).

## What it is

Module ResourceManager.Model: file 1, plugin 5, ui 91. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- file-type Preset files (file:file-type/Preset files): .pre presets in profile\ResourceViewerPresets; Save preset / New preset; no rename or delete in the UI
- panel Details (ui:ResourceManager.Model/panel/#qt_tabwidget_tabbar)
- panel Details: Bones (ui:ResourceManager.Model/panel/Details: Bones): Bone hierarchy, move / rotate bones
- panel Details: Colliders (ui:ResourceManager.Model/panel/Details: Colliders): Options (Hide mesh, Show center of mass, outlines, transparent, high contrast, Filter colliders, Show invalid shapes), Layers, per-collider type, material, coords, angles, vertices, faces, LayerPreset, interaction layers
- panel Details: LODs (ui:ResourceManager.Model/panel/Details: LODs): Per-LOD vertices, faces, materials, meshes, UV view; force / unselect LOD
- panel Details: Land Contacts (ui:ResourceManager.Model/panel/Details: Land Contacts): Shows LC_ snap points
- panel Details: Materials (ui:ResourceManager.Model/panel/Details: Materials): Lists materials, highlight, isolate, open the material editor
- panel Details: Occluders (ui:ResourceManager.Model/panel/Details: Occluders): Project all / Show all, type, vertex count, bounds
- panel Details: Runtime Details (ui:ResourceManager.Model/panel/Details: Runtime Details): Current LOD, faces, vertices, land contacts, size, allocated VB, materials, textures, texture size, volume info, surface under cursor
- panel Import Settings tab (per platform) (ui:ResourceManager.Model/panel/Import Settings tab (per platform)): See section 2.10
- panel Viewport: Options (ui:ResourceManager.Model/panel/Viewport: Options): Scene preset, scene settings (grid, ground, compass, axis), wireframe, overlay, environment, lighting, camera, postprocessing (default ssr.emat, hbao.emat)
- window Open model (ui:ResourceManager.Model/window/Open model): 3D viewer

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| file | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| plugin | 5 | 0 | 0 | 0 | 0 | 0 | 5 |
| ui | 32 | 24 | 35 | 0 | 0 | 0 | 91 |

## By kind

- control: 16
- file-type: 1
- menu: 3
- panel: 10
- plugin: 5
- region: 10
- tab: 5
- tool: 1
- toolbar: 3
- toolbar-button: 42
- window: 1

## By risk

- mutating: 64
- safe: 33

## Rows by kind

### control (16)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Model/control/@QPushButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Model/control/@WBTreeWidget.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Model/control/BSP %2F Portals | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Model/control/Bones | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Model/control/Colliders | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Model/control/Compass gizmo | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Model/control/LODs | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Model/control/Land Contacts | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Model/control/Materials | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Model/control/Morphs | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Model/control/Occluders | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Model/control/Probe Volumes | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Model/control/Runtime Stats | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Model/control/Toolbar: Colliders | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Model/control/Toolbar: Show%2Fhide grid | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Model/control/Toolbar: Show%2Fhide volumetric info | T0/T5 | candidate: gui-automation | none |

### file-type (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| file:file-type/Preset files | T0/T3 | candidate: file-format | none |

### menu (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Model/menu/Viewport: Overlays | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Model/menu/Viewport: Shading | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Model/menu/Viewport: View | T0/T3 | candidate: gui-automation | none |

### panel (10)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Model/panel/#qt_tabwidget_tabbar | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Model/panel/Details: Bones | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Model/panel/Details: Colliders | T0/T3 | candidate: gui-automation, net-api-handler | none |
| ui:ResourceManager.Model/panel/Details: LODs | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Model/panel/Details: Land Contacts | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Model/panel/Details: Materials | T0/T3 | candidate: builtin-net-handler, net-api-handler | none |
| ui:ResourceManager.Model/panel/Details: Occluders | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Model/panel/Details: Runtime Details | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Model/panel/Import Settings tab (per platform) | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:ResourceManager.Model/panel/Viewport: Options | T0/T3 | candidate: file-format, gui-automation | none |

### plugin (5)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:plugin/EBT: Bake MLOD | T0/T5 | candidate: gui-automation, plugin-run | none |
| plugin:plugin/EBT: Config | T0/T5 | candidate: file-format, plugin-run | none |
| plugin:plugin/EBT: Send To Blender | T0/T5 | candidate: gui-automation, plugin-run | none |
| plugin:plugin/Search Tool (XOBs) plugin | T0/T5 | candidate: plugin-run | none |
| plugin:plugin/Validate Asset plugin | T0/T5 | candidate: gui-automation, plugin-run | none |

### region (10)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Model/region/@MeshDetails::MaterialsPage.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Model/region/@QScrollArea.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Model/region/@QSplitterHandle.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Model/region/@QToolBar.1/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Model/region/@QToolBar.1/@QWidget.2 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Model/region/@QToolBar.2/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Model/region/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Model/region/@QWidget.2 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Model/region/@QWidget.3 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Model/region/@SceneRenderWindow.1 | T0/T2 | candidate: gui-automation | none |

### tab (5)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Model/tab/#DockingTabBar | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Model/tab/Details Tab | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Model/tab/Import Settings Tab | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Model/tab/qt_tabwidget_tabbar/Details | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Model/tab/qt_tabwidget_tabbar/Import Settings | T1/T3 | candidate: gui-automation | none |

### tool (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Model/tool/Toolbar: Pick material | T0/T5 | candidate: gui-automation | none |

### toolbar (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Model/toolbar/@QToolBar.1 | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Model/toolbar/@QToolBar.2 | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Model/toolbar/Horizontal bar | T1/T3 | candidate: gui-automation | none |

### toolbar-button (42)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/BSP | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Background color | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Camera auto placement | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Change FOV | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Colliders | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/EV Minus | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/EV Plus | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Focus Selection | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Lock EV | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Move | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Position to ground | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Reset entity rotations | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Reset model bones transformations to init state | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Rotate | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Show bones | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Show grid | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Show volumetric info | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Toggle Gizmo Space | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Turn camera to POI on mouse wheel | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Visibility occlusion | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.2/Options | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.2/Overlay | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.2/Shading | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.2/View | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/Horizontal bar/Background color | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/Horizontal bar/Camera auto placement | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/Horizontal bar/Change FOV | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/Horizontal bar/Colliders | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/Horizontal bar/EV tools - lock, plus and minus | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/Horizontal bar/Focus selected object | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/Horizontal bar/Move tool | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/Horizontal bar/Pick material | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/Horizontal bar/Reset entity rotation | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/Horizontal bar/Reset model bones transformations to init state | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/Horizontal bar/Rotate tool | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/Horizontal bar/Show%2Fhide all bones | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/Horizontal bar/Show%2Fhide grid | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/Horizontal bar/Show%2Fhide volumetric info | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/Horizontal bar/Snap position to ground | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Model/toolbar-button/Horizontal bar/To world%2Fobject space | T1/T5 | candidate: execute-action, gui-automation | none |

2 more: wb_census find with module=ResourceManager.Model kind=toolbar-button.

### window (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Model/window/Open model | T1/T3 | candidate: builtin-net-handler, net-api-handler | none |

## Below target (97)

- T0 to T2: 10
- T0 to T3: 15
- T0 to T5: 13
- T1 to T3: 7
- T1 to T5: 17
- T2 to T3: 1
- T2 to T5: 34

| id | tier | path |
| --- | --- | --- |
| file:file-type/Preset files | T0/T3 | candidate: file-format |
| plugin:plugin/EBT: Bake MLOD | T0/T5 | candidate: gui-automation, plugin-run |
| plugin:plugin/EBT: Config | T0/T5 | candidate: file-format, plugin-run |
| plugin:plugin/EBT: Send To Blender | T0/T5 | candidate: gui-automation, plugin-run |
| plugin:plugin/Search Tool (XOBs) plugin | T0/T5 | candidate: plugin-run |
| plugin:plugin/Validate Asset plugin | T0/T5 | candidate: gui-automation, plugin-run |
| ui:ResourceManager.Model/control/@QPushButton.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Model/control/@WBTreeWidget.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Model/control/BSP %2F Portals | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Model/control/Bones | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Model/control/Colliders | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Model/control/Compass gizmo | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Model/control/LODs | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Model/control/Land Contacts | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Model/control/Materials | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Model/control/Morphs | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Model/control/Occluders | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Model/control/Probe Volumes | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Model/control/Runtime Stats | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Model/control/Toolbar: Colliders | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Model/control/Toolbar: Show%2Fhide grid | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Model/control/Toolbar: Show%2Fhide volumetric info | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Model/menu/Viewport: Overlays | T0/T3 | candidate: gui-automation |
| ui:ResourceManager.Model/menu/Viewport: Shading | T0/T3 | candidate: gui-automation |
| ui:ResourceManager.Model/menu/Viewport: View | T0/T3 | candidate: gui-automation |
| ui:ResourceManager.Model/panel/#qt_tabwidget_tabbar | T2/T3 | candidate: gui-automation |
| ui:ResourceManager.Model/panel/Details: Bones | T0/T3 | candidate: gui-automation |
| ui:ResourceManager.Model/panel/Details: Colliders | T0/T3 | candidate: gui-automation, net-api-handler |
| ui:ResourceManager.Model/panel/Details: LODs | T0/T3 | candidate: gui-automation |
| ui:ResourceManager.Model/panel/Details: Land Contacts | T0/T3 | candidate: gui-automation |
| ui:ResourceManager.Model/panel/Details: Materials | T0/T3 | candidate: builtin-net-handler, net-api-handler |
| ui:ResourceManager.Model/panel/Details: Occluders | T0/T3 | candidate: gui-automation |
| ui:ResourceManager.Model/panel/Details: Runtime Details | T0/T3 | candidate: gui-automation |
| ui:ResourceManager.Model/panel/Import Settings tab (per platform) | T0/T3 | candidate: file-format, net-api-handler |
| ui:ResourceManager.Model/panel/Viewport: Options | T0/T3 | candidate: file-format, gui-automation |
| ui:ResourceManager.Model/region/@MeshDetails::MaterialsPage.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Model/region/@QScrollArea.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Model/region/@QSplitterHandle.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Model/region/@QToolBar.1/@QWidget.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Model/region/@QToolBar.1/@QWidget.2 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Model/region/@QToolBar.2/@QWidget.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Model/region/@QWidget.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Model/region/@QWidget.2 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Model/region/@QWidget.3 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Model/region/@SceneRenderWindow.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Model/tab/#DockingTabBar | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Model/tab/Details Tab | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Model/tab/Import Settings Tab | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Model/tab/qt_tabwidget_tabbar/Details | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Model/tab/qt_tabwidget_tabbar/Import Settings | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Model/tool/Toolbar: Pick material | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/BSP | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Background color | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Camera auto placement | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Change FOV | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Colliders | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/EV Minus | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/EV Plus | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Focus Selection | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Model/toolbar-button/@QToolBar.1/Lock EV | T2/T5 | candidate: execute-action, gui-automation |

37 more: wb_census find with module=ResourceManager.Model.

## Dispositions (0)

No row of this module carries a disposition.
