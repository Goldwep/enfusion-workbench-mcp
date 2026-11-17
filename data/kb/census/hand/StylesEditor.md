# Styles Editor

## What it is

- The Styles Editor is the Resource Manager widget style editor for `.styles` files; the ledger notes there is no wiki page for it in the dump. [row: ui:ResourceManager.Material/window/Styles Editor (.styles)]
- A `.styles` file defines UI styles. [row: file:.styles]
- The `.styles` row is linked to read-role actions of ui_styles_inspect and ui_layout_validate, and of the project index tools. [row: file:.styles]
- The `.styles` row is at tier T2 against a target of T3, with file-format as its only candidate path. [row: file:.styles]

## File structure (read from the 1.9.0.37 paks)

- A WSWidgetStyle is the root: 2 instances in 2 `.styles` files. [row: schema:WSWidgetStyle]
- A WSWidgetStyle holds a Widgets key. [row: schema:WSWidgetStyle.Widgets]
- A WSWidget has a Name key and a Styles key; 83 instances in 6 files, root and nested. [row: schema:WSWidget] [row: schema:WSWidget.Name] [row: schema:WSWidget.Styles]
- A WSStyle has Name, Font, ImageSet and States keys; 114 instances in 6 files. [row: schema:WSStyle] [row: schema:WSStyle.Name] [row: schema:WSStyle.Font] [row: schema:WSStyle.ImageSet] [row: schema:WSStyle.States]
- A WSState has Name and Items keys; 246 instances in 6 files. [row: schema:WSState] [row: schema:WSState.Name] [row: schema:WSState.Items]
- A WSItem has Name and Image keys; 3116 instances in 6 files. [row: schema:WSItem] [row: schema:WSItem.Name] [row: schema:WSItem.Image]

## What the window holds (live walk of build 1.9.0.37)

- A document tab was seen named editor.styles. [row: ui:ResourceManager.Styles/tab/#DockingTabBar]
- The editor is split into panels named Widget Style, States, Image Picker, Style Preview and ImageSet Groups. [row: ui:ResourceManager.Styles/panel/Widget Style] [row: ui:ResourceManager.Styles/panel/States] [row: ui:ResourceManager.Styles/panel/Image Picker] [row: ui:ResourceManager.Styles/panel/Style Preview] [row: ui:ResourceManager.Styles/panel/#groupBox_3]
- A WidgetStyle menu is present. [row: ui:ResourceManager.Styles/menu/WidgetStyle]
- The widget tree of the styles file open lists ButtonWidget and EditBoxWidget. [row: ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/ButtonWidget] [row: ui:ResourceManager.Styles/control/Widget Style/@QTreeWidget.1/EditBoxWidget]
- Buttons exist to add and remove widgets and styles. [row: ui:ResourceManager.Styles/control/#addWidgetButton] [row: ui:ResourceManager.Styles/control/#removeWidgetButton] [row: ui:ResourceManager.Styles/control/#addStyleButton] [row: ui:ResourceManager.Styles/control/#removeStyleButton]
- A Clear Image button sits under States. [row: ui:ResourceManager.Styles/control/#clearButton]
- A states tree and a groups tree are present. [row: ui:ResourceManager.Styles/control/#statesTree] [row: ui:ResourceManager.Styles/control/#groupsTree]
- The ledger names the control with automation id nameEdit as Font: and the one with fontEdit as ImageSet:; whether these names are shifted by one control is [unverified]. [row: ui:ResourceManager.Styles/control/#nameEdit] [row: ui:ResourceManager.Styles/control/#fontEdit]
- A named group has no row kind of its own, so the ledger records each group box as a panel. [row: ui:ResourceManager.Styles/panel/States]
- The only candidate path recorded for the Add Style button is gui-automation. [row: ui:ResourceManager.Styles/control/#addStyleButton]

[Module page: ResourceManager.Styles](../modules/ResourceManager.Styles.md)
