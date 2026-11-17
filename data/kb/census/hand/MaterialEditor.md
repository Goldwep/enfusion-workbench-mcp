# Material Editor

## What it is

- The Material Editor is a Resource Manager window for `.emat` files: a property grid plus a preview for a material. [row: ui:ResourceManager.Material/window/Material Editor (.emat) UI]
- The ledger records that the wiki page for it is a TODO placeholder, so the wiki says nothing usable about it. [row: ui:ResourceManager.Material/window/Material Editor (.emat) UI]
- An `.emat` file defines a material for 3D objects, terrain, post processes, water and sky objects. [row: file:.emat]
- The only candidate path recorded for the window is gui-automation, at tier T1 against a target of T3. [row: ui:ResourceManager.Material/window/Material Editor (.emat) UI]

## Reading and checking materials from tools

- The `.emat` file-type row is linked to read-role actions of asset_search, material_inspect, material_diff and material_find_unused_textures. [row: file:.emat]
- A semantic diff of two `.emat` files is an offline file-format function: its only recorded path is file-format, and its recon source names the material_diff tool, though the row carries no MCP link yet. [row: api:method/Diff materials]
- A list of textures that no material references is an offline file-format function: its only recorded path is file-format, and its recon source names the material_find_unused_textures tool, though the row carries no MCP link yet. [row: api:method/Unused textures]
- Reading a material returns the shader class and every property. [row: api:method/Read material]
- A list of every `.gamemat` resource is a separate function of the same module. [row: api:method/Game materials list]
- A validation-rules row lists UV tiling as uniform and within 0..5. [row: api:method/Material validation rules]

## What the window holds (live walk of build 1.9.0.37)

- A document tab was seen named lightSourceDefault.emat. [row: ui:ResourceManager.Material/tab/#DockingTabBar]
- A Details tab and an Import Settings tab sit in the lower dock. [row: ui:ResourceManager.Material/tab/qt_tabwidget_tabbar/Details] [row: ui:ResourceManager.Material/tab/qt_tabwidget_tabbar/Import Settings]
- The property grid's category rows depend on the material open: the W8 run 8 material showed Basic material maps and its modifiers and Global MCR Map. [row: ui:ResourceManager.Material/property-group/@PropertyGridBC.1/Basic material maps and its modifiers] [row: ui:ResourceManager.Material/property-group/@PropertyGridBC.1/Global MCR Map]
- Leaf property rows of the grid are not in this module's rows; they belong to another enumerator. [row: ui:ResourceManager.Material/property-group/@PropertyGridBC.1]
- Named controls are Change Class, Parent Material and Resource Variants (its label carries a live count). [row: ui:ResourceManager.Material/control/Change Class] [row: ui:ResourceManager.Material/control/Parent Material] [row: ui:ResourceManager.Material/control/Resource Variants]
- The preview area is a SceneRenderWindow region. [row: ui:ResourceManager.Material/region/@SceneRenderWindow.1]
- Preview model buttons include Sphere model, Plane model and Box model. [row: ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Sphere model] [row: ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Plane model] [row: ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Box model]
- Preview exposure (EV) buttons include EV Minus, EV Plus and Lock EV. [row: ui:ResourceManager.Material/toolbar-button/@QToolBar.1/EV Minus] [row: ui:ResourceManager.Material/toolbar-button/@QToolBar.1/EV Plus] [row: ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Lock EV]
- A second toolbar holds Options, Overlay, Shading and View. [row: ui:ResourceManager.Material/toolbar-button/@QToolBar.2/Options] [row: ui:ResourceManager.Material/toolbar-button/@QToolBar.2/Overlay] [row: ui:ResourceManager.Material/toolbar-button/@QToolBar.2/Shading] [row: ui:ResourceManager.Material/toolbar-button/@QToolBar.2/View]
- The checked state of the checkable preview buttons is not recorded, for example Box model. [row: ui:ResourceManager.Material/toolbar-button/@QToolBar.1/Box model]
- Several buttons and the toolbars have no accessible name, so the ledger identifies them by order only. [row: ui:ResourceManager.Material/toolbar/@QToolBar.1]

## Neighbouring windows in the same module

- Font Viewer, Styles Editor, Prefab preview and Ragdoll are listed as sibling windows. [row: ui:ResourceManager.Material/window/Font Viewer (.fnt, .ttf)] [row: ui:ResourceManager.Material/window/Styles Editor (.styles)] [row: ui:ResourceManager.Material/window/Prefab preview (.et) in RM] [row: ui:ResourceManager.Material/window/Ragdoll (.ragdoll)]

[Module page: ResourceManager.Material](../modules/ResourceManager.Material.md)
