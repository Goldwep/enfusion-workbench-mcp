# Recipe: canvas gestures (graph, curve, scene, drag-drop)

Status: documented, not proven. Probe P-W8-18 (hand block) records a sample of three canvases. No shipped tool drives it (DEC-076 OD-2).

## Census rows covered

About 89 `ui:<Module>/canvas-gesture/...` rows outside the World Editor mouse tools (those are in `mouse-tools.md`):

- AudioEditor 12 (Connections: duplicate connection; Scene: zoom in and out)
- AnimEditor 8 (Anim Editor Preview: camera move, rotate around the center; Animation Graph: zoom and unzoom)
- BehaviorEditor 8 (Node area: connect nodes; open scripted node script)
- ResourceManager 4, ResourceManager.Config 1, ResourceManager.Layout 1 (drag a config object into the browser, fill a sub-config by drag-drop, drag a layout prefab into a layout; tab double-click and middle-click)

Route `pixel`, outcome "pixel recipe", target T2.

## Anchor

The canvas rectangle from `opaque-regions.md` for the same module and row. Gesture coordinates are fractions of that rectangle (for example 25 percent across and 40 percent down), never absolute screen pixels. Nodes, curve points and tree items are located by a screenshot of the canvas first, then clicked at their visible centre. Drag-drop rows start from a UIA-visible source (resource browser item, config tree item) and end inside the canvas rectangle.

## Screenshot region

The canvas rectangle before and after each gesture, at the same zoom. A third capture after the undo proves the revert. A gesture passes when "after" differs from "before" in the described way (node moved, link drawn, view changed, item added) and the "undone" capture matches "before".

## Steps (hand block)

Always on a throwaway resource (a scratch graph, behavior tree or animation graph created for the probe; no shipped asset). Never press Save.

1. Open the module and the throwaway resource; screenshot the canvas (before).
2. Perform one gesture per row with computer use (`left_click_drag`, or `left_mouse_down`, `mouse_move`, `left_mouse_up` for slow drags):
   - node drag or connect nodes: press on a node header, move in two or three steps, release on empty canvas or on a free port;
   - duplicate connection: select the link, then use the key or context item the census row text names;
   - zoom: wheel `scroll` over the canvas centre, 2 ticks in then 2 ticks out;
   - camera move or rotate (AnimEditor preview): the mouse button and drag the row names;
   - drag-drop from a browser or tree: press on the source item, drag into the canvas rectangle, release; a drop that opens a dialog is cancelled with Cancel.
3. Screenshot (after) and note the change.
4. Undo (below) and screenshot (undone).

## Undo

`Ctrl+Z` once per gesture with the canvas focused (click an empty canvas spot first), or `wb_undo_redo` where the editor exposes it. Camera and zoom gestures are view state with no undo entry: reset with the module's reset-view action, or close the resource without saving. If a gesture cannot be undone, stop, discard the throwaway resource without saving, and mark the family documented-only (P-W8-18 kill condition).

## Probe and kill

P-W8-18, sampling three canvases (graph node drag, curve point move, gizmo drag). Kill: a gesture cannot be undone.
