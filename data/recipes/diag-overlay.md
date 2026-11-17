# Recipe: diag overlay, three-menu sample

Status: documented, not proven. Probe P-W8-09 (hand block). No shipped tool drives it (DEC-076 OD-2, OD-10).

## Census rows covered

- `diag:diag-option/...` rows with no script id: about 1300 of the 1611 rows of the diag shard (E14 1582, E07+E14 29, E01 5; 29 top-level menus). They stay T2, documented, outside the universe (OD-10). Only a sample of three menus is walked.
- The one ledger row gated on P-W8-09.

Rows with a script id are reached by `wb_diag` (`catalog`, `get`, `set`, `select`) and are not part of this recipe. The overlay is the in-game Diag Menu drawn in the render window; UIA does not expose it, hence a pixel recipe.

## Anchor

The play-mode render window (game window) rectangle from `opaque-regions.md`. The menu is opened by the game's own binding for the Diag Menu; read the binding from `wb_settings shortcuts` or the input config [unverified on 1.9]. The overlay sits at the top-left of the render window; take its rectangle from the first capture after opening.

## Screenshot region

The overlay rectangle only, at 2x zoom. One capture per menu level: the top-level list, then each of the three chosen submenus. The sample is three menus: one that matches a `wb_diag catalog` path (a script-id menu, as the control), one native menu with no script id, and one with a range or toggle. A menu passes when the captured entries match the catalog names and order.

## Steps (hand block)

1. Start a scratch scenario in play (`wb_play`) on a throwaway project; keep the session short. List the profile folder before (`logs_list` or a `wb_diag info` environment read), as a placeholder path in the notes, never a personal one.
2. Open the Diag Menu with its binding; screenshot (top level).
3. Move with the arrow keys (`key`), open a submenu with Enter or Right, screenshot, go back with Left or Escape. Repeat for the three menus. Do not change any value: this is read only. If a toggle must be flipped to be seen, flip it back before leaving.
4. Close the menu; stop play (`wb_stop`).
5. List the profile folder again and name any file that appeared or changed. This answers whether `-diagMenu` persists state to a file.
6. Compare the captured names with `wb_diag catalog` and record matches and mismatches.

## Undo

Close the menu with its binding or Escape; set any flipped toggle back before closing. Memory-only diag values reset when the play session ends. Leave no scenario or profile file behind: a state file the probe names is deleted only after the owner has seen it.

## Probe and kill

P-W8-09. Expected: overlay captured, three menus match the catalog, any state file named. Kill: the overlay does not open under computer use; the native diag rows stay documented-only.
