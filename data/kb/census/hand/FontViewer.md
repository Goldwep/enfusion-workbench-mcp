# Font Viewer

## What it is

- The Font Viewer is a Resource Manager window that previews a font; the ledger notes there is no wiki page for it in the dump. [row: ui:ResourceManager.Material/window/Font Viewer (.fnt, .ttf)]
- A `.fnt` file is a font for the UI widget system, in a binary format. [row: file:.fnt]
- The `.fnt` row names the Font Viewer as its Resource Manager editor. [row: file:.fnt]
- A `.ttf` file is the source font format that Enfusion supports. [row: file:.ttf]
- The `.fnt` row has no tool action linked yet and its only candidate path is file-format, at tier T2 against a target of T3. [row: file:.fnt]

## What the window holds (live walk of build 1.9.0.37)

- A document tab was seen named Roboto_Regular.fnt. [row: ui:ResourceManager.Font/tab/#DockingTabBar]
- A Details tab and an Import Settings tab sit in the lower dock. [row: ui:ResourceManager.Font/tab/qt_tabwidget_tabbar/Details] [row: ui:ResourceManager.Font/tab/qt_tabwidget_tabbar/Import Settings]
- A property grid titled Font properties holds the font settings. [row: ui:ResourceManager.Font/property-group/#PropertyGrid]
- A toolbar carries the controls Size:, Outline:, Shadow:, Offset: and R. [row: ui:ResourceManager.Font/control/@QToolBar.1/Size:] [row: ui:ResourceManager.Font/control/@QToolBar.1/Outline:] [row: ui:ResourceManager.Font/control/@QToolBar.1/Shadow:] [row: ui:ResourceManager.Font/control/@QToolBar.1/Offset:] [row: ui:ResourceManager.Font/control/@QToolBar.1/R]
- A Check Characters button is present. [row: ui:ResourceManager.Font/control/Check Characters]
- The preview area is a WidgetsPreviewWindow region. [row: ui:ResourceManager.Font/region/@WidgetsPreviewWindow.1]
- The only candidate path recorded for Check Characters is gui-automation. [row: ui:ResourceManager.Font/control/Check Characters]
- Several toolbar buttons have no accessible name, so the ledger identifies them by order only. [row: ui:ResourceManager.Font/control/@QToolBar.1/@QPushButton.1]

## Not to be confused with

- The Script Editor options Font Family and Font Size set the editor text font and are not the Font Viewer. [row: ui:ResourceManager/option/Options/Script Editor/Font Family] [row: ui:ResourceManager/option/Options/Script Editor/Font Size]

[Module page: ResourceManager.Font](../modules/ResourceManager.Font.md)
