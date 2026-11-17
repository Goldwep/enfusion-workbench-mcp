# Recipe: World Editor mouse tools

Status: documented, not proven. Probe P-W8-18 (hand block) records the sample. No shipped tool drives it (DEC-076 OD-2).

## Census rows covered

- `ui:WorldEditor/canvas-gesture/...` (41 rows, 15 of them pixel-routed here): Viewport camera keys (W/S, A/D, Q/Z, wheel speed, orientation change, focus on the selected entity), Rotate Tool (hold Ctrl; duplicate then rotate the copy), Terrain Creation Tool sculpt (radius, strength/height, falloff, angle), Vector Tool (add a point before or after the selected one).
- `ui:Shared/canvas-gesture/<tool>/...` (14 rows): MeasureTool (MouseMove, MousePress, KeyPress KC_ESCAPE), SCR_AutoSpawnerTool, SCR_PrefabBoneSnappingTool (MouseMove, MousePress, Leave, Escape), SCR_ShapeBrushTool (MousePress and MouseRelease LEFT, Leave, Wheel CONTROL).
- `plugin:` rows routed `pixel`: MeasureTool, SCR_ObjectBrushTool (and button DeleteEntities), SCR_SelectionBrushTool, SCR_ShapeBrushTool, SCR_PrefabBoneSnappingTool (buttons ButtonOpenPrefabInEditMode, ButtonRefresh), SCR_WorldWindowDataDropPlugin.

Target T2 (documented). The handler tools (`wb_entity_*`, `wb_terrain`, `wb_shape`) reach the same effects without the mouse; this recipe exists for the gesture itself.

## Anchor

The World Editor render window rectangle from `opaque-regions.md` (`WorldRenderWindowQt`). Tools are activated through their toolbar button or menu item by UIA (`wb_gui` invoke with a current-build locator, else `wb_menu`), not by pixel. Gesture points are fractions of the viewport rectangle. Aim at a known target: create one throwaway entity with `wb_entity_create` on a scratch layer at a known position, select it with `wb_entity_select`, then frame it with the Viewport focus gesture so it sits near the viewport centre.

## Screenshot region

The viewport rectangle before and after, plus the Object Properties or the tool's own panel when the effect is numeric. Read the exact value with `wb_entity_inspect`, which is preferred over pixels for the check. A gizmo gesture passes when the entity's inspected value changed in the documented way and returned after undo.

## Steps (hand block)

1. Open a throwaway world on a scratch project, never a shipped world. Do not enter play mode unless the row says so.
2. Select the tool; screenshot the viewport.
3. Perform the gesture with computer use:
   - camera: `hold_key` for a second (W, S, A, D, Q, Z); wheel `scroll` over the viewport for speed; the documented drag for orientation; the focus key with the entity selected;
   - Rotate Tool: left-drag the rotation ring one step; with Ctrl held (`hold_key` ctrl) drag to duplicate and rotate the copy;
   - Vector Tool: with a shape selected, click a segment with the documented modifier to add a point before or after the selected one;
   - Terrain Creation Tool sculpt: the documented modifier plus wheel for radius, strength/height, falloff, angle; one short stroke, on a throwaway terrain only;
   - MeasureTool: press at one point, move, press at a second; Escape ends;
   - brush and spawner tools: one press and release on empty ground; Leave is moving the pointer out of the viewport.
4. Screenshot after; read the exact value through `wb_entity_inspect` where applicable.
5. Undo.

## Undo

`Ctrl+Z` with the viewport focused, or `wb_undo_redo`, once per gesture. For a brush stroke or a duplicate, check with `wb_entity_list` that the entity count is back. Camera moves have no undo: restore with a bookmark or reload the world without saving. Escape leaves a tool mode. End by deleting the throwaway entity (`wb_entity_delete`) and closing the world with No to the save prompt.

## Probe and kill

P-W8-18. Kill: a gesture cannot be undone; stop and mark the family documented-only. Terrain sculpt runs last, and only if the earlier gestures undo cleanly.
