# Census: ResourceManager.Imageset

88 rows (3 aggregate excluded).

## What it is

Module ResourceManager.Imageset: cli 1, file 2, plugin 1, schema 19, ui 65. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- file-type .imageset (file:.imageset): Defines a set of images by cuts from a texture
- file-type .imageset file format (file:file-type/.imageset file format): ImageSetClass { RefSize w h [Textures { ImageSetTextureClass { mpix 1 directory "path" } }] Groups { ImageSetGroupClass "name" { Name "..." Images { ImageSetDefClass name { Name "..." Pos x y Size w h Flags 0 } } } } }
- schema-class ImageSetClass (schema:ImageSetClass): 142 instances in 142 .imageset files of the 1.9.0.37 paks; root
- schema-class ImageSetDefClass (schema:ImageSetDefClass): 9740 instances in 142 .imageset files of the 1.9.0.37 paks; nested
- schema-class ImageSetGroupClass (schema:ImageSetGroupClass): 123 instances in 18 .imageset files of the 1.9.0.37 paks; nested
- schema-class ImageSetTextureClass (schema:ImageSetTextureClass): 394 instances in 142 .imageset files of the 1.9.0.37 paks; nested
- panel ImageSet (ui:ResourceManager.Imageset/panel/@QTabBar.1)
- panel Details (ui:ResourceManager.Imageset/panel/@QTabBar.2)
- panel Details (ui:ResourceManager.Imageset/panel/Details)
- panel ImageSet (ui:ResourceManager.Imageset/panel/ImageSet)
- panel Quad Properties (ui:ResourceManager.Imageset/panel/Quad Properties): Edit the selected quad.
- panel Quads List (ui:ResourceManager.Imageset/panel/Quads List): List the images, by group if any.
- ... 2 more

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cli | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| file | 1 | 0 | 1 | 0 | 0 | 0 | 2 |
| plugin | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| schema | 1 | 0 | 18 | 0 | 0 | 0 | 19 |
| ui | 16 | 33 | 16 | 0 | 0 | 0 | 65 |

## By kind

- cli-switch: 1
- control: 16
- file-type: 2
- menu: 1
- menu-item: 4
- panel: 7
- plugin: 1
- property: 1
- region: 7
- schema-class: 4
- schema-key: 14
- tab: 12
- toolbar: 3
- toolbar-button: 14
- window: 1

## By risk

- destructive: 1
- mutating: 35
- safe: 52

## Rows by kind

### cli-switch (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| cli:cli-switch/Imageset texture rebuild | T0/T5 | candidate: cli | none |

### control (16)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Imageset/control/#addFromFilesButton | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/control/#addTextureButton | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/control/@QPushButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/control/@QTreeWidget.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/control/@QTreeWidget.1/@TreeItem.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/control/@QTreeWidget.1/UI%2FTextures%2FIcons%2Ficons_keyboard_32_atlas.edds | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/control/ImageSet Tab/Add | T1/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/control/ImageSet Tab/From files | T1/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/control/ImageSet Tab/Remove | T1/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/control/ImageSet Tab/Texture | T1/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/control/Quad Properties/Group | T1/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/control/Quad Properties/Horizontal Tile | T1/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/control/Quad Properties/Name | T1/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/control/Quad Properties/Position and Dimensions | T1/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/control/Quad Properties/Vertical Tile | T1/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/control/Resource Variants | T2/T5 | candidate: gui-automation | none |

### file-type (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| file:.imageset | T2/T3 | candidate: file-format | [imageset.addGroup](../tools/imageset.md) drive, [imageset.addQuad](../tools/imageset.md) drive, [imageset.addTexture](../tools/imageset.md) drive, [imageset.create](../tools/imageset.md) drive, [imageset.read](../tools/imageset.md) read, [imageset.remove](../tools/imageset.md) drive, [imageset.removeTexture](../tools/imageset.md) drive, [imageset.setQuad](../tools/imageset.md) drive |
| file:file-type/.imageset file format | T0/T3 | candidate: file-format | none |

### menu (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Imageset/menu/ImageSet | T2/T3 | candidate: gui-automation | none |

### menu-item (4)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Imageset/menu-item/ImageSet/Add 3x3 | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Imageset/menu-item/ImageSet/Add Group | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Imageset/menu-item/ImageSet/Add Image | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Imageset/menu-item/ImageSet/Delete Image | T2/T5 | candidate: execute-action, gui-automation | none |

### panel (7)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Imageset/panel/@QTabBar.1 | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/panel/@QTabBar.2 | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/panel/Details | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/panel/ImageSet | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/panel/Quad Properties | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/panel/Quads List | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/panel/Quads tab: list by group | T0/T3 | candidate: file-format | none |

### plugin (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| plugin:plugin/Image Set Generator plugin | T0/T5 | candidate: file-format, plugin-run | none |

### property (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:property/Import Settings: tags | T0/T2 | candidate: file-format, net-api-handler | none |

### region (7)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Imageset/region/#ImageSetEditorDetails | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/region/#label_2 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/region/@ImageSetPreviewWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/region/@QSplitterHandle.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/region/@QTreeWidget.1/@Header.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/region/@QTreeWidget.1/@Header.2 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/region/@QWidget.1 | T0/T2 | candidate: gui-automation | none |

### schema-class (4)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:ImageSetClass | T2/T2 | candidate: file-format | none |
| schema:ImageSetDefClass | T2/T2 | candidate: file-format | none |
| schema:ImageSetGroupClass | T2/T2 | candidate: file-format | none |
| schema:ImageSetTextureClass | T2/T2 | candidate: file-format | none |

### schema-key (14)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:ImageSetClass.Groups | T2/T2 | candidate: file-format | none |
| schema:ImageSetClass.Images | T2/T2 | candidate: file-format | none |
| schema:ImageSetClass.RefSize | T2/T2 | candidate: file-format | none |
| schema:ImageSetClass.Textures | T2/T2 | candidate: file-format | none |
| schema:ImageSetDefClass.Flags | T2/T2 | candidate: file-format | none |
| schema:ImageSetDefClass.Name | T2/T2 | candidate: file-format | none |
| schema:ImageSetDefClass.Pos | T2/T2 | candidate: file-format | none |
| schema:ImageSetDefClass.Size | T2/T2 | candidate: file-format | none |
| schema:ImageSetGroupClass.Images | T2/T2 | candidate: file-format | none |
| schema:ImageSetGroupClass.Name | T2/T2 | candidate: file-format | none |
| schema:ImageSetTextureClass.mpix | T2/T2 | candidate: file-format | none |
| schema:ImageSetTextureClass.path | T2/T2 | candidate: file-format | none |
| schema:ImageSetTextureClass.screenSize | T2/T2 | candidate: file-format | none |
| schema:ImageSetTextureClass.size | T2/T2 | candidate: file-format | none |

### tab (12)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Imageset/tab/#DockingTabBar | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/tab/@QTabBar.1/ImageSet | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/tab/@QTabBar.1/Quads | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/tab/@QTabBar.2/Details | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/tab/@QTabBar.2/Import Settings | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/tab/Details/Details | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/tab/Details/Import Settings | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/tab/ImageSet Tab | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/tab/ImageSet/ImageSet | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/tab/ImageSet/Quads | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/tab/Import Settings Tab | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/tab/Quads Tab | T1/T3 | candidate: gui-automation | none |

### toolbar (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Imageset/toolbar/@QToolBar.1 | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/toolbar/Quads Buttons | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Imageset/toolbar/Top Bar | T1/T3 | candidate: gui-automation | none |

### toolbar-button (14)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Imageset/toolbar-button/@QToolBar.1/Reload Image | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Imageset/toolbar-button/@QToolBar.1/Reset View | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Imageset/toolbar-button/@QToolBar.1/Reset Zoom | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Imageset/toolbar-button/Quads Buttons/Add | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Imageset/toolbar-button/Quads Buttons/Add 3×3 | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Imageset/toolbar-button/Quads Buttons/Add Group | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Imageset/toolbar-button/Quads Buttons/Delete | T1/T2 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Imageset/toolbar-button/Quads: Add | T0/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager.Imageset/toolbar-button/Quads: Add 3x3 | T0/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager.Imageset/toolbar-button/Quads: Add Group | T0/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager.Imageset/toolbar-button/Quads: Delete | T0/T5 | candidate: file-format, gui-automation | none |
| ui:ResourceManager.Imageset/toolbar-button/Reload Image | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Imageset/toolbar-button/Reset View | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Imageset/toolbar-button/Reset Zoom | T1/T5 | candidate: execute-action, gui-automation | none |

### window (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Imageset/window/Open imageset | T1/T3 | candidate: net-api-handler | none |

## Below target (70)

- T0 to T2: 8
- T0 to T3: 3
- T0 to T5: 9
- T1 to T2: 1
- T1 to T3: 17
- T1 to T5: 15
- T2 to T3: 6
- T2 to T5: 11

| id | tier | path |
| --- | --- | --- |
| cli:cli-switch/Imageset texture rebuild | T0/T5 | candidate: cli |
| file:.imageset | T2/T3 | candidate: file-format |
| file:file-type/.imageset file format | T0/T3 | candidate: file-format |
| plugin:plugin/Image Set Generator plugin | T0/T5 | candidate: file-format, plugin-run |
| schema:property/Import Settings: tags | T0/T2 | candidate: file-format, net-api-handler |
| ui:ResourceManager.Imageset/control/#addFromFilesButton | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Imageset/control/#addTextureButton | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Imageset/control/@QPushButton.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Imageset/control/@QTreeWidget.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Imageset/control/@QTreeWidget.1/@TreeItem.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Imageset/control/@QTreeWidget.1/UI%2FTextures%2FIcons%2Ficons_keyboard_32_atlas.edds | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Imageset/control/ImageSet Tab/Add | T1/T5 | candidate: gui-automation |
| ui:ResourceManager.Imageset/control/ImageSet Tab/From files | T1/T5 | candidate: gui-automation |
| ui:ResourceManager.Imageset/control/ImageSet Tab/Remove | T1/T5 | candidate: gui-automation |
| ui:ResourceManager.Imageset/control/ImageSet Tab/Texture | T1/T5 | candidate: gui-automation |
| ui:ResourceManager.Imageset/control/Quad Properties/Group | T1/T5 | candidate: gui-automation |
| ui:ResourceManager.Imageset/control/Quad Properties/Horizontal Tile | T1/T5 | candidate: gui-automation |
| ui:ResourceManager.Imageset/control/Quad Properties/Name | T1/T5 | candidate: gui-automation |
| ui:ResourceManager.Imageset/control/Quad Properties/Position and Dimensions | T1/T5 | candidate: gui-automation |
| ui:ResourceManager.Imageset/control/Quad Properties/Vertical Tile | T1/T5 | candidate: gui-automation |
| ui:ResourceManager.Imageset/control/Resource Variants | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Imageset/menu-item/ImageSet/Add 3x3 | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Imageset/menu-item/ImageSet/Add Group | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Imageset/menu-item/ImageSet/Add Image | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Imageset/menu-item/ImageSet/Delete Image | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Imageset/menu/ImageSet | T2/T3 | candidate: gui-automation |
| ui:ResourceManager.Imageset/panel/@QTabBar.1 | T2/T3 | candidate: gui-automation |
| ui:ResourceManager.Imageset/panel/@QTabBar.2 | T2/T3 | candidate: gui-automation |
| ui:ResourceManager.Imageset/panel/Details | T2/T3 | candidate: gui-automation |
| ui:ResourceManager.Imageset/panel/ImageSet | T2/T3 | candidate: gui-automation |
| ui:ResourceManager.Imageset/panel/Quad Properties | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Imageset/panel/Quads List | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Imageset/panel/Quads tab: list by group | T0/T3 | candidate: file-format |
| ui:ResourceManager.Imageset/region/#ImageSetEditorDetails | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Imageset/region/#label_2 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Imageset/region/@ImageSetPreviewWidget.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Imageset/region/@QSplitterHandle.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Imageset/region/@QTreeWidget.1/@Header.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Imageset/region/@QTreeWidget.1/@Header.2 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Imageset/region/@QWidget.1 | T0/T2 | candidate: gui-automation |
| ui:ResourceManager.Imageset/tab/#DockingTabBar | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Imageset/tab/@QTabBar.1/ImageSet | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Imageset/tab/@QTabBar.1/Quads | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Imageset/tab/@QTabBar.2/Details | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Imageset/tab/@QTabBar.2/Import Settings | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Imageset/tab/Details/Details | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Imageset/tab/Details/Import Settings | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Imageset/tab/ImageSet Tab | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Imageset/tab/ImageSet/ImageSet | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Imageset/tab/ImageSet/Quads | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Imageset/tab/Import Settings Tab | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Imageset/tab/Quads Tab | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Imageset/toolbar-button/@QToolBar.1/Reload Image | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Imageset/toolbar-button/@QToolBar.1/Reset View | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Imageset/toolbar-button/@QToolBar.1/Reset Zoom | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Imageset/toolbar-button/Quads Buttons/Add | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Imageset/toolbar-button/Quads Buttons/Add 3×3 | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Imageset/toolbar-button/Quads Buttons/Add Group | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Imageset/toolbar-button/Quads Buttons/Delete | T1/T2 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Imageset/toolbar-button/Quads: Add | T0/T5 | candidate: file-format, gui-automation |

10 more: wb_census find with module=ResourceManager.Imageset.

## Dispositions (1)

| id | kind | why | evidence |
| --- | --- | --- | --- |
| ui:ResourceManager.Imageset/toolbar-button/Quads Buttons/Delete | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
