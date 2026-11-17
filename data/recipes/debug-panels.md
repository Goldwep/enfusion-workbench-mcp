# Recipe: in-play debug panels (DbgUI)

Status: documented, not proven. Probe P-W8-10 (hand block). No shipped tool drives the pixel read (DEC-076 OD-2).

## Census rows covered

2 rows: `ui:Shared/debug-panel/AI Debug Panel` and `diag:diag-option/AI Debug Panel` (BehaviorEditor module). Both are routed `pixel`, covered by `wb_diag.set` with `via: equivalent` (reach T3 for the switch, T2 for the pixel proof), blocked on P-W8-10. The panel is drawn in the render window in play, so UIA cannot read it.

## Anchor

The play-mode render window rectangle from `opaque-regions.md`. Debug panels appear as titled windows inside it. Find the panel by its title text ("AI Debug Panel") in a full-window capture, then fix its rectangle for the zoom. The panel position is not stable between runs, so anchor on the title, not on coordinates.

## Screenshot region

One full render-window capture with the panel off as the baseline; after enabling, the same capture plus a 2x zoom of the panel rectangle; after disabling, a capture that shows it gone. The row passes when the panel is visible and its title matches.

## Steps (hand block)

1. Open a throwaway project and start play (`wb_play`) with a scenario that has AI, so the panel has content; keep the session short.
2. Baseline screenshot.
3. Enable the panel with `wb_diag set`, using the diag id of the AI debug panel from `wb_diag catalog`. The call is gated on the `diag.set_allow_list` key (OD-6), seeded empty and filled only from P-W8-07's evidence. If the id is not listed the call answers GATED, and the probe waits for that evidence. The switch is memory-only.
4. Screenshot and zoom; record the panel title and its visible sections.
5. Disable the panel with `wb_diag set` back to the value in the `previous` field of the enabling call; screenshot to prove it closed.
6. Stop play (`wb_stop`).

## Undo

The `wb_diag set` back to `previous`. The value is memory-only and also resets when the play session ends. Nothing is saved and no file is written.

## Probe and kill

P-W8-10. Expected: the panel is visible and matches its title. Kill: no panel shows; the in-play debug panel rows stay documented-only.
