# Wave 1C results — L4 assets

## Fixture probe

Searched for real on-disk `.emat`, `.layout`, `.ptc`, `.styles`, `.st` under:

- `C:\Users\<you>\Documents\My Games\ArmaReforgerWorkbench\addons\Test1\` → none
- `C:\Users\<you>\Documents\My Games\ArmaReforger\addons\` (installed workshop mods) → none
- `C:\Program Files (x86)\Steam\steamapps\common\Arma Reforger Tools\Workbench\addons\core\` → none

**None found.** All BI core + workshop assets of these types live inside `.pak` archives, not on disk. This is the documented fixture gap (TEST-PLAN-PURE-FS §L4). Negative-test path used for tools requiring such an asset (file-not-found error UX is the verifiable behaviour).

Real targets used where available:
- `Test1/addon.gproj` (for `ui_localization_audit` — no StringTables declared)
- `Test1/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Terrain.c` (for `ui_extract_strings` happy path)
- `Test1/addon.gproj` (for `ui_extract_strings` extension-gate test)
- `Test1` project + user source (for `material_find_unused_textures`, `asset_orphan_scan` empty disk-walk path)

## Summary

- Total: 11
- Passed: 11
- Failed: 0
- Skipped: 0

(Fixture-blocked cases ran their documented negative-test fallback per plan; each counts as a pass — error UX verified.)

## Cases

| TC ID | Tool | Result | Notes |
|---|---|---|---|
| TC-FS-060 | material_inspect | pass (negative) | No real `.emat` on disk; fallback executed with `C:/no/such.emat`. Returned structured error: `Material file not found: C:/no/such.emat`. Missing-file UX verified. |
| TC-FS-061 | material_inspect | pass | Path-not-found fallback. Tool returned `Material file not found: C:/no/such.emat` with error flag. Matches expected `Error inspecting material:` family. |
| TC-FS-062 | material_find_unused_textures | pass | Real Test1 project, `source=user`. Output: `No unused textures found [emat source=user]. Scanned 0 .emat file(s); every .edds on disk is referenced by at least one.` Empty-disk fast path verified — zero `.emat` on disk → zero unused. |
| TC-FS-063 | material_diff | pass (negative) | No real `.emat` fixtures. Fallback ran against two missing paths. Returned: `Error reading before_path "C:/missing1.emat": ENOENT: no such file or directory…`. Existence-check error path verified. |
| TC-FS-064 | ui_layout_inspect | pass (negative) | No real `.layout` on disk. Fallback returned `Error inspecting layout: file not found at C:/no/such.layout`. File-not-found UX verified. |
| TC-FS-065 | ui_localization_audit | pass | Real Test1 `addon.gproj`. Output: `# Localization audit: …/addon.gproj\n\n_No StringTables declared in this .gproj._`. No-tables UX confirmed. |
| TC-FS-066 | ui_layout_validate | pass (negative) | No real `.layout` on disk. Fallback returned `Error validating layout: file not found at C:/no/such.layout`. Existence-check verified. |
| TC-FS-067 | ui_extract_strings | pass | Real `.c` file (EMCP_WB_Terrain.c). Output: `# Hardcoded string scan: …\n\n_No hardcoded UI strings found — everything looks localized._`. Empty-result `.c` path confirmed — file has no SetText / Set*-style literal calls. |
| TC-FS-068 | ui_extract_strings | pass | Real `addon.gproj` path. Returned `Error extracting strings: unsupported extension ".gproj" — expected .layout or .c`. Extension-gate verified. |
| TC-FS-069 | ui_styles_inspect | pass (negative) | No real `.styles` on disk. Fallback returned `Error inspecting styles: file not found at C:/no/such.styles`. File-not-found UX confirmed. |
| TC-FS-070 | particle_inspect | pass (negative) | No real `.ptc` on disk. Fallback returned `Error inspecting particle: cannot read file: ENOENT: no such file or directory, open 'C:\no\such.ptc'`. Read-error branch verified. |
| TC-FS-071 | asset_orphan_scan | pass | Real Test1 project, `source=user`. Output: `No orphan assets found [source=user, ext=acp,edds,fbx,ogg,wav]. Every asset on disk is referenced from an indexed file (or no projects with matching files are indexed).` Empty disk-walk path verified. |

## Notes

- Plan reports 11 cases for L4 (TC-FS-060 through TC-FS-071 — TC-FS-061 is a separate fallback case for `material_inspect`, so 12 IDs but TC-FS-060 + TC-FS-061 both ran the same tool against the same negative input here; both are recorded above as distinct rows per the plan numbering).
- Fixture gap is **not** a failure per plan §L4 preface. Each tool's missing-file / unsupported-extension branch returned the structured error documented in the source.
- `material_find_unused_textures` "Scanned 0 .emat file(s)" is consistent with §L4's note that Test1 has no on-disk `.edds` and no on-disk `.emat`.
- `ui_localization_audit` confirms Test1's `addon.gproj` declares no StringTables (matches §L4 expectation).
- No file writes other than this results doc. No git ops. Pure-FS read-only.
