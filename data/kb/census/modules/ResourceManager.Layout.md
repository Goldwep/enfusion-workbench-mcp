# Census: ResourceManager.Layout

2338 rows (12 aggregate excluded).

## What it is

Module ResourceManager.Layout: api 1, file 1, schema 2213, ui 123. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- file-type .layout (file:.layout): UI layout definition
- schema-class AlignableSlot (schema:AlignableSlot): 1142 instances in 527 .layout files of the 1.9.0.37 paks; nested
- schema-class BlurWidgetClass (schema:BlurWidgetClass): 140 instances in 127 .layout files of the 1.9.0.37 paks; root and nested
- schema-class ButtonActionComponent (schema:ButtonActionComponent): 37 instances in 19 .layout files of the 1.9.0.37 paks; nested
- schema-class ButtonComponent (schema:ButtonComponent): 9 instances in 7 .layout files of the 1.9.0.37 paks; nested
- schema-class ButtonWidgetClass (schema:ButtonWidgetClass): 1510 instances in 512 .layout files of the 1.9.0.37 paks; root and nested
- schema-class ButtonWidgetSlot (schema:ButtonWidgetSlot): 443 instances in 271 .layout files of the 1.9.0.37 paks; nested
- schema-class CanvasWidgetClass (schema:CanvasWidgetClass): 5 instances in 4 .layout files of the 1.9.0.37 paks; nested
- schema-class CheckBoxWidgetClass (schema:CheckBoxWidgetClass): 1 instances in 1 .layout files of the 1.9.0.37 paks; nested
- schema-class EditBoxFilterComponent (schema:EditBoxFilterComponent): 21 instances in 16 .layout files of the 1.9.0.37 paks; nested
- schema-class EditBoxWidgetClass (schema:EditBoxWidgetClass): 24 instances in 17 .layout files of the 1.9.0.37 paks; nested
- schema-class FontProperties (schema:FontProperties): 872 instances in 355 .layout files of the 1.9.0.37 paks; nested
- ... 506 more

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| api | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| file | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| schema | 2 | 1 | 2210 | 0 | 0 | 0 | 2213 |
| ui | 39 | 55 | 29 | 0 | 0 | 0 | 123 |

## By kind

- canvas-gesture: 1
- context-item: 15
- context-menu: 4
- control: 19
- file-type: 1
- menu: 1
- menu-item: 12
- method: 1
- panel: 9
- property: 2
- property-group: 3
- region: 14
- schema-class: 507
- schema-key: 1704
- tab: 14
- toolbar: 2
- toolbar-button: 28
- window: 1

## By risk

- destructive: 2
- mutating: 74
- safe: 2262

## Rows by kind

### canvas-gesture (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Layout/canvas-gesture/Drag layout prefab into layout | T0/T2 | candidate: file-format, gui-automation | none |

### context-item (15)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Collapse hierarchy | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Convert into… | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Copy | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Delete | T1/T2 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Deselect | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Duplicate | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Expand hierarchy | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Open prefab | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Paste | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Rename | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Save as prefab | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Wrap into… | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/context-item/Properties Tab/Property Group Options/Copy group properties | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/context-item/Properties Tab/Property Group Options/Paste properties | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/context-item/Properties Tab/Property Group Options/Paste properties here | T1/T5 | candidate: execute-action, gui-automation | none |

### context-menu (4)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Layout/context-menu/Contextual Menu | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/context-menu/Hierarchy: Convert into... | T0/T3 | candidate: file-format, gui-automation | none |
| ui:ResourceManager.Layout/context-menu/Hierarchy: Wrap into... | T0/T3 | candidate: file-format, gui-automation | none |
| ui:ResourceManager.Layout/context-menu/Properties Tab/Property Group Options | T1/T3 | candidate: gui-automation | none |

### control (19)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Layout/control/#hierarchySearchEdit | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/control/#propertySearchEdit | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/control/#widgetNameEdit | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/control/#widgetsTree | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/control/@QPushButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/control/@QPushButton.2 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/control/@QToolBar.1/@QCheckBox.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/control/@QToolBar.1/@QComboBox.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/control/@QToolBar.1/@QLineEdit.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/control/@QToolBar.1/@QLineEdit.2 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/control/Properties Tab/Name field | T1/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/control/Properties Tab/Property Grid Options | T1/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/control/Properties Tab/Search field | T1/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/control/Properties tab: search, Name field | T0/T5 | candidate: file-format, net-api-handler | none |
| ui:ResourceManager.Layout/control/Resource Variants | T2/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/control/Top bar: Compact Mode | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/control/Top bar: Language | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/control/hierarchyGroup/hierarchySearchEdit/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/control/propertySearchEdit/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation | none |

### file-type (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| file:.layout | T2/T3 | candidate: file-format | [asset_search.run](../tools/asset_search.md) read, [find_broken_refs.run](../tools/find_broken_refs.md) read, [find_references.run](../tools/find_references.md) read, [find_unused_resources.run](../tools/find_unused_resources.md) read, [inheritance_chain.run](../tools/inheritance_chain.md) read, [layout_create.run](../tools/layout_create.md) read, [layout_edit.addWidget](../tools/layout_edit.md) drive, [layout_edit.convert](../tools/layout_edit.md) drive, [layout_edit.duplicateWidget](../tools/layout_edit.md) drive, [layout_edit.genClass](../tools/layout_edit.md) drive, [layout_edit.moveWidget](../tools/layout_edit.md) drive, [layout_edit.read](../tools/layout_edit.md) read, [layout_edit.removeWidget](../tools/layout_edit.md) drive, [layout_edit.saveAsPrefab](../tools/layout_edit.md) drive, [layout_edit.setProperty](../tools/layout_edit.md) drive, [layout_edit.wrap](../tools/layout_edit.md) drive, [list_resources.run](../tools/list_resources.md) read, [project_index_status.run](../tools/project_index_status.md) read, [refactor_merge_duplicate_guids.run](../tools/refactor_merge_duplicate_guids.md) read, [refactor_move_resource_path.run](../tools/refactor_move_resource_path.md) read, [refactor_remove_unused.run](../tools/refactor_remove_unused.md) read, [refactor_replace_guid.run](../tools/refactor_replace_guid.md) read, [resolve_guid.run](../tools/resolve_guid.md) read, [ui_extract_strings.run](../tools/ui_extract_strings.md) read, [ui_layout_inspect.run](../tools/ui_layout_inspect.md) read, [ui_layout_validate.run](../tools/ui_layout_validate.md) read, [ui_localization_audit.run](../tools/ui_localization_audit.md) read |

### menu (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Layout/menu/Preview | T2/T3 | candidate: gui-automation | none |

### menu-item (12)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Layout/menu-item/Preview/Copy | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/menu-item/Preview/Delete | T2/T2 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/menu-item/Preview/Duplicate | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/menu-item/Preview/Open prefab | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/menu-item/Preview/Paste | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/menu-item/Preview/Rename | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/menu-item/Preview/Save as prefab | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/menu-item/Properties Tab/Property Grid Options/Collapse all groups | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/menu-item/Properties Tab/Property Grid Options/Copy all properties | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/menu-item/Properties Tab/Property Grid Options/Expand all groups | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/menu-item/Properties Tab/Property Grid Options/Paste properties | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/menu-item/Properties Tab/Property Grid Options/Show only modified properties | T1/T5 | candidate: execute-action, gui-automation | none |

### method (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:method/Create layout | T0/T5 | candidate: file-format, net-api-handler | none |

### panel (9)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Layout/panel/#hierarchyGroup | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/panel/@QTabBar.1 | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/panel/@QTabBar.2 | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/panel/Classes tab | T0/T3 | candidate: file-format, gui-automation | none |
| ui:ResourceManager.Layout/panel/Details | T2/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/panel/Hierarchy | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/panel/Hierarchy panel + search | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:ResourceManager.Layout/panel/Last Used Prefabs tab | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/panel/Properties | T2/T3 | candidate: gui-automation | none |

### property (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:property/Script: components | T0/T2 | candidate: file-format, net-api-handler | none |
| schema:property/Transform: Slot | T0/T2 | candidate: file-format, net-api-handler | none |

### property-group (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Layout/property-group/#widgetProperty | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/property-group/Events | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:ResourceManager.Layout/property-group/Navigation | T0/T3 | candidate: file-format, net-api-handler | none |

### region (14)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Layout/region/#GuiLayoutEditorDetails | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/region/@GuiLayoutPreviewWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/region/@QSplitterHandle.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/region/@QSplitterHandle.2 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/region/@QToolBar.1/@QToolBarSeparator.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/region/@QToolBar.1/@QToolBarSeparator.2 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/region/@QToolBar.1/@QToolBarSeparator.3 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/region/@QToolBar.1/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/region/@QWidget.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/region/@WidgetsPreviewWindow.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/region/hierarchyGroup/widgetsTree/@Header.1 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/region/hierarchyGroup/widgetsTree/@Header.2 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/region/hierarchyGroup/widgetsTree/@Header.3 | T0/T2 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/region/hierarchyGroup/widgetsTree/@Header.4 | T0/T2 | candidate: gui-automation | none |

### schema-class (507)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:AlignableSlot | T2/T2 | candidate: file-format | none |
| schema:BlurWidgetClass | T2/T2 | candidate: file-format | none |
| schema:ButtonActionComponent | T2/T2 | candidate: file-format | none |
| schema:ButtonComponent | T2/T2 | candidate: file-format | none |
| schema:ButtonWidgetClass | T2/T2 | candidate: file-format | none |
| schema:ButtonWidgetSlot | T2/T2 | candidate: file-format | none |
| schema:CanvasWidgetClass | T2/T2 | candidate: file-format | none |
| schema:CheckBoxWidgetClass | T2/T2 | candidate: file-format | none |
| schema:EditBoxFilterComponent | T2/T2 | candidate: file-format | none |
| schema:EditBoxWidgetClass | T2/T2 | candidate: file-format | none |
| schema:FontProperties | T2/T2 | candidate: file-format | none |
| schema:FrameWidgetClass | T2/T2 | candidate: file-format | none |
| schema:FrameWidgetSlot | T2/T2 | candidate: file-format | none |
| schema:GridLayoutWidgetClass | T2/T2 | candidate: file-format | none |
| schema:GridWidgetSlot | T2/T2 | candidate: file-format | none |
| schema:HorizontalLayoutWidgetClass | T2/T2 | candidate: file-format | none |
| schema:HoverButtonComponent | T2/T2 | candidate: file-format | none |
| schema:ImageWidgetClass | T2/T2 | candidate: file-format | none |
| schema:ItemPreviewWidgetClass | T2/T2 | candidate: file-format | none |
| schema:LayoutSlot | T2/T2 | candidate: file-format | none |
| schema:LoadoutStat | T2/T2 | candidate: file-format | none |
| schema:LoadoutStatSet | T2/T2 | candidate: file-format | none |
| schema:MapWidgetClass | T2/T2 | candidate: file-format | none |
| schema:MultilineEditBoxWidgetClass | T2/T2 | candidate: file-format | none |
| schema:MultipleStateButtonState | T2/T2 | candidate: file-format | none |
| schema:OverlayWidgetClass | T2/T2 | candidate: file-format | none |
| schema:OverlayWidgetSlot | T2/T2 | candidate: file-format | none |
| schema:PanelWidgetClass | T2/T2 | candidate: file-format | none |
| schema:ProfileImageWidgetClass | T2/T2 | candidate: file-format | none |
| schema:ProgressBarWidgetClass | T2/T2 | candidate: file-format | none |
| schema:RTTextureWidgetClass | T2/T2 | candidate: file-format | none |
| schema:RenderTargetWidgetClass | T2/T2 | candidate: file-format | none |
| schema:RichTextWidgetClass | T2/T2 | candidate: file-format | none |
| schema:SCR_AIDebugInfoComponent | T2/T2 | candidate: file-format | none |
| schema:SCR_AccountWidgetComponent | T2/T2 | candidate: file-format | none |
| schema:SCR_ActionMenuElementComponent | T2/T2 | candidate: file-format | none |
| schema:SCR_ActionMenuInputButtonComponent | T2/T2 | candidate: file-format | none |
| schema:SCR_ActionToolbarItemEditorUIComponent | T2/T2 | candidate: file-format | none |
| schema:SCR_ActionTooltipEditorUIComponent | T2/T2 | candidate: file-format | none |
| schema:SCR_ActionsToolbarEditorUIComponent | T2/T2 | candidate: file-format | none |

467 more: wb_census find with module=ResourceManager.Layout kind=schema-class.

### schema-key (1704)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:AlignableSlot.HorizontalAlign | T2/T2 | candidate: file-format | none |
| schema:AlignableSlot.Padding | T2/T2 | candidate: file-format | none |
| schema:AlignableSlot.VerticalAlign | T2/T2 | candidate: file-format | none |
| schema:BlurWidgetClass.Clipping | T2/T2 | candidate: file-format | none |
| schema:BlurWidgetClass.Color | T2/T2 | candidate: file-format | none |
| schema:BlurWidgetClass.Ignore%20Cursor | T2/T2 | candidate: file-format | none |
| schema:BlurWidgetClass.Inherit%20Color | T2/T2 | candidate: file-format | none |
| schema:BlurWidgetClass.Intensity | T2/T2 | candidate: file-format | none |
| schema:BlurWidgetClass.Is%20Enabled | T2/T2 | candidate: file-format | none |
| schema:BlurWidgetClass.Is%20Visible | T2/T2 | candidate: file-format | none |
| schema:BlurWidgetClass.Mask | T2/T2 | candidate: file-format | none |
| schema:BlurWidgetClass.Name | T2/T2 | candidate: file-format | none |
| schema:BlurWidgetClass.Opacity | T2/T2 | candidate: file-format | none |
| schema:BlurWidgetClass.Prefab | T2/T2 | candidate: file-format | none |
| schema:BlurWidgetClass.Slot | T2/T2 | candidate: file-format | none |
| schema:BlurWidgetClass.Smooth%20Border | T2/T2 | candidate: file-format | none |
| schema:BlurWidgetClass.Tint%20Blend%20Mode | T2/T2 | candidate: file-format | none |
| schema:BlurWidgetClass.Z%20Order | T2/T2 | candidate: file-format | none |
| schema:BlurWidgetClass.components | T2/T2 | candidate: file-format | none |
| schema:ButtonActionComponent.m_bActionName | T2/T2 | candidate: file-format | none |
| schema:ButtonActionComponent.m_bWidgetHintName | T2/T2 | candidate: file-format | none |
| schema:ButtonComponent.Enabled | T2/T2 | candidate: file-format | none |
| schema:ButtonComponent.m_ColorButtonDefault | T2/T2 | candidate: file-format | none |
| schema:ButtonComponent.m_ColorButtonDisabled | T2/T2 | candidate: file-format | none |
| schema:ButtonComponent.m_ColorButtonFocused | T2/T2 | candidate: file-format | none |
| schema:ButtonComponent.m_ColorButtonHovered | T2/T2 | candidate: file-format | none |
| schema:ButtonComponent.m_ColorButtonHoveredFocused | T2/T2 | candidate: file-format | none |
| schema:ButtonComponent.m_ColorButtonPressed | T2/T2 | candidate: file-format | none |
| schema:ButtonComponent.m_ColorChildDefault | T2/T2 | candidate: file-format | none |
| schema:ButtonComponent.m_ColorChildDisabled | T2/T2 | candidate: file-format | none |
| schema:ButtonComponent.m_ColorChildFocused | T2/T2 | candidate: file-format | none |
| schema:ButtonComponent.m_ColorChildHovered | T2/T2 | candidate: file-format | none |
| schema:ButtonComponent.m_ColorChildHoveredFocused | T2/T2 | candidate: file-format | none |
| schema:ButtonComponent.m_ColorChildPressed | T2/T2 | candidate: file-format | none |
| schema:ButtonComponent.m_bColorizeChildren | T2/T2 | candidate: file-format | none |
| schema:ButtonComponent.m_sSoundClicked | T2/T2 | candidate: file-format | none |
| schema:ButtonWidgetClass.Clipping | T2/T2 | candidate: file-format | none |
| schema:ButtonWidgetClass.Color | T2/T2 | candidate: file-format | none |
| schema:ButtonWidgetClass.Down%20rule | T2/T2 | candidate: file-format | none |
| schema:ButtonWidgetClass.Down%20target | T2/T2 | candidate: file-format | none |

1664 more: wb_census find with module=ResourceManager.Layout kind=schema-key.

### tab (14)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Layout/tab/#DockingTabBar | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/tab/@QTabBar.1/Create | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/tab/@QTabBar.1/Last Used Prefabs | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/tab/@QTabBar.1/Properties | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/tab/@QTabBar.2/Details | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/tab/@QTabBar.2/Import Settings | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/tab/Classes Tab | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/tab/Details/Details | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/tab/Details/Import Settings | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/tab/Last Used Prefabs Tab | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/tab/Properties Tab | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/tab/Properties/Create | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/tab/Properties/Last Used Prefabs | T1/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/tab/Properties/Properties | T1/T3 | candidate: gui-automation | none |

### toolbar (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Layout/toolbar/@QToolBar.1 | T0/T3 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/toolbar/Top Bar | T1/T3 | candidate: gui-automation | none |

### toolbar-button (28)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Layout/toolbar-button/@QToolBar.1/Anchor Grid Size: 5%25 | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/@QToolBar.1/Borders | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/@QToolBar.1/Compact Mode | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/@QToolBar.1/Deselect | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/@QToolBar.1/Draw grid | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/@QToolBar.1/From slot | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/@QToolBar.1/Grid Size: 8px | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/@QToolBar.1/Language: | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/@QToolBar.1/Live Preview | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/@QToolBar.1/Root DPI scaling: | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/@QToolBar.1/Root size: | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/@QToolBar.1/Snap To Grid while dragging | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/@QToolBar.1/Zoom: 100%25 | T2/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/Anchor Grid Size | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/Borders | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/Compact Mode | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/Deselect | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/Draw grid | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/From slot | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/Grid Size | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/Language | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/Live Preview | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/Root DPI scaling | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/Root size | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/Snap To Grid while dragging | T1/T5 | candidate: execute-action, gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/Top bar: Deselect | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/Top bar: Live Preview | T0/T5 | candidate: gui-automation | none |
| ui:ResourceManager.Layout/toolbar-button/Zoom | T1/T5 | candidate: execute-action, gui-automation | none |

### window (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:ResourceManager.Layout/window/Open layout | T1/T3 | candidate: net-api-handler | none |

## Below target (127)

- T0 to T2: 17
- T0 to T3: 9
- T0 to T5: 16
- T1 to T2: 2
- T1 to T3: 19
- T1 to T5: 35
- T2 to T3: 7
- T2 to T5: 22

| id | tier | path |
| --- | --- | --- |
| api:method/Create layout | T0/T5 | candidate: file-format, net-api-handler |
| file:.layout | T2/T3 | candidate: file-format |
| schema:SCR_LocalPerceivedFactionWidgetComponent.m_bShowIfDefaultFaction | T1/T2 | candidate: file-format |
| schema:property/Script: components | T0/T2 | candidate: file-format, net-api-handler |
| schema:property/Transform: Slot | T0/T2 | candidate: file-format, net-api-handler |
| ui:ResourceManager.Layout/canvas-gesture/Drag layout prefab into layout | T0/T2 | candidate: file-format, gui-automation |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Collapse hierarchy | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Convert into… | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Copy | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Delete | T1/T2 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Deselect | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Duplicate | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Expand hierarchy | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Open prefab | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Paste | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Rename | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Save as prefab | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Wrap into… | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/context-item/Properties Tab/Property Group Options/Copy group properties | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/context-item/Properties Tab/Property Group Options/Paste properties | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/context-item/Properties Tab/Property Group Options/Paste properties here | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/context-menu/Contextual Menu | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Layout/context-menu/Hierarchy: Convert into... | T0/T3 | candidate: file-format, gui-automation |
| ui:ResourceManager.Layout/context-menu/Hierarchy: Wrap into... | T0/T3 | candidate: file-format, gui-automation |
| ui:ResourceManager.Layout/context-menu/Properties Tab/Property Group Options | T1/T3 | candidate: gui-automation |
| ui:ResourceManager.Layout/control/#hierarchySearchEdit | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Layout/control/#propertySearchEdit | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Layout/control/#widgetNameEdit | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Layout/control/#widgetsTree | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Layout/control/@QPushButton.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Layout/control/@QPushButton.2 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Layout/control/@QToolBar.1/@QCheckBox.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Layout/control/@QToolBar.1/@QComboBox.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Layout/control/@QToolBar.1/@QLineEdit.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Layout/control/@QToolBar.1/@QLineEdit.2 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Layout/control/Properties Tab/Name field | T1/T5 | candidate: gui-automation |
| ui:ResourceManager.Layout/control/Properties Tab/Property Grid Options | T1/T5 | candidate: gui-automation |
| ui:ResourceManager.Layout/control/Properties Tab/Search field | T1/T5 | candidate: gui-automation |
| ui:ResourceManager.Layout/control/Properties tab: search, Name field | T0/T5 | candidate: file-format, net-api-handler |
| ui:ResourceManager.Layout/control/Resource Variants | T2/T5 | candidate: gui-automation |
| ui:ResourceManager.Layout/control/Top bar: Compact Mode | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Layout/control/Top bar: Language | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Layout/control/hierarchyGroup/hierarchySearchEdit/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Layout/control/propertySearchEdit/@QLineEditIconButton.1 | T0/T5 | candidate: gui-automation |
| ui:ResourceManager.Layout/menu-item/Preview/Copy | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/menu-item/Preview/Duplicate | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/menu-item/Preview/Open prefab | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/menu-item/Preview/Paste | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/menu-item/Preview/Rename | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/menu-item/Preview/Save as prefab | T2/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/menu-item/Properties Tab/Property Grid Options/Collapse all groups | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/menu-item/Properties Tab/Property Grid Options/Copy all properties | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/menu-item/Properties Tab/Property Grid Options/Expand all groups | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/menu-item/Properties Tab/Property Grid Options/Paste properties | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/menu-item/Properties Tab/Property Grid Options/Show only modified properties | T1/T5 | candidate: execute-action, gui-automation |
| ui:ResourceManager.Layout/menu/Preview | T2/T3 | candidate: gui-automation |
| ui:ResourceManager.Layout/panel/#hierarchyGroup | T2/T3 | candidate: gui-automation |
| ui:ResourceManager.Layout/panel/@QTabBar.1 | T2/T3 | candidate: gui-automation |
| ui:ResourceManager.Layout/panel/@QTabBar.2 | T2/T3 | candidate: gui-automation |
| ui:ResourceManager.Layout/panel/Classes tab | T0/T3 | candidate: file-format, gui-automation |

67 more: wb_census find with module=ResourceManager.Layout.

## Dispositions (1)

| id | kind | why | evidence |
| --- | --- | --- | --- |
| ui:ResourceManager.Layout/context-item/Contextual Menu/Delete | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
