# Recipe: opaque render-window and canvas regions

Status: documented, not proven. Probe P-W8-17 (hand block) records it. No shipped tool drives it (DEC-076 OD-2): computer use runs it in the hand block only.

## Census rows covered

About 275 `ui:<Module>/region/...` rows (render windows and custom-drawn canvases that UIA reports as a childless Group), routed `pixel`, outcome "pixel recipe", target T2 (documented). Modules and row counts: WorldEditor 48, AnimEditor 39, AudioEditor 25, ResourceManager 23, ProcAnimEditor 20, ScriptEditor 18, BehaviorEditor 17, ResourceManager.Layout 14, .Texture 13, .Styles 12, .Model 9, .Font 9, .Material 8, .Imageset 7, .Config 5, LocalizationEditor 5. Typical names: `@SceneRenderWindow.N`, `WorldRenderWindowQt`, `@WidgetsPreviewWindow.N`, `@TexturePreviewWindow.N`, `@ImageSetPreviewWidget.N`, `#WidgetStyleEditorPreview`, `@QSizeGrip.N`, `@QToolBarSeparator.N`, `@Header.N`.

## Anchor

Anchor on the module window, never on screen coordinates. A region is found by its parent, in this order:

1. The module's top-level window (title from the census `window` row, for example `#WorldEditor`). Read its bounding rectangle with `wb_gui` (tree or find) so the anchor survives a moved or resized window.
2. The nearest named ancestor with a UIA rectangle (dock, tab page, group). Take the region's own rectangle from `wb_gui` when it reports one; the census `region` row names the Qt class and index.
3. Where UIA gives no rectangle (render windows), take the rectangle of the dock or tab page that holds it and subtract the toolbar and status bar rows above and below. The result is the region.

A region that moves with the layout (docked elsewhere, floating, tab not selected) is not found by this recipe: its rows stay documented-only with the layout note (P-W8-17 kill condition).

## Screenshot region

- Grant the Workbench executable by basename before the first screenshot. Secondary-monitor dialogs are not captured, so keep the editor on the primary display.
- Select the tab or dock that holds the region so it is visible and not covered by a modal. Check the modal list first (`wb_gui modals`); with a modal open, stop.
- Take one `zoom` of the computed rectangle. For separators, size grips and headers (a few pixels or a thin strip) zoom at least 4x on a 100 px margin around the anchor.
- Record: module, row id, window title, rectangle used, build number from the status bar, and the screenshot name. Compare with the L07 region capture output for the same row; the row passes when both name the same rectangle within a few pixels.

## Steps (hand block)

1. Launch the editor with `wb_launch`; open the module (`wb_module`). For resource-bound modules open one throwaway resource of the right type (a scratch copy, never a shipped one).
2. `wb_gui` tree: read the window and dock rectangles.
3. Bring the target tab or dock forward by `wb_gui` invoke where a locator exists, else one left click on the tab.
4. Screenshot the region as above and record the result against the row.
5. Repeat per row. Rows that share one render window (several `@SceneRenderWindow` instances with the same rectangle) share one capture.

## Undo

Capture only reads. If a tab or dock was changed to bring the region forward, click the original tab back. Save nothing; answer No or Cancel to any prompt when closing the throwaway resource. Close the module, then the Workbench through `wb_stop`.

## Probe and kill

P-W8-17. Kill: a region moves with the layout; its rows then fall to documented-only.
