# Test results — v1.0.0 full sweep (2026-05-22)

> **2026-09-02 total audit:** see [CODE-REVIEW-2026-09-fable5.md](./CODE-REVIEW-2026-09-fable5.md) for the current findings list; entries below that the audit refuted are annotated inline. Animation e2e note: `tests/animation/integration-m151a2.test.ts` was removed (H18) — it hardcoded a non-existent fixture dir and always skipped. An animation parser/validator end-to-end check needs local `.agr/.agf/.ast/.asi/.aw` fixtures from a real project; the unit suites under `tests/animation/` still cover the parsers on inline samples.

Comprehensive test pass across 112 MCP tools. Drives off:
- `docs/TEST-PLAN-PURE-FS.md` — 115 cases
- `docs/TEST-PLAN-WRITE-MODE.md` — 106 cases
- `docs/TEST-PLAN-LIVE-WORKBENCH.md` — 134 cases (incl. 4 TC-MUST)
- Per-wave detail in `docs/TEST-RESULTS-WAVE-{1A,1B,1C,1D,2,3}.md`

## Summary

| Wave | Total | Pass | Fail | Skip | Partial |
|---|---:|---:|---:|---:|---:|
| 1A — L1 search + L2 reverse-query + L3 project_validate | 33 | 28 | 3 | 2 | — |
| 1B — L3 logs + world/scenario + workshop | 22 | 22 | 0 | 0 | — |
| 1C — L4 assets | 11 | 11 | 0 | 0 | — |
| 1D — L6 scripts + L8 read-only + prompts | 17 | 13 | 0 | 4 | — |
| 2 — Write-mode dry-runs + L7 placeholders + server_config | 16 | 15 | 0 | 0 | 1 |
| 3 — Live refactors in sandbox | 7 | 4 | 1 | 1 | 1 |
| 4 — Live Workbench wb_* (main thread) | ~25 | 18 | 2 | 5 | — |
| 5 — MUST-tests | 4 | 2 | 1 | 1 | — |
| 6 — Server lifecycle | 3 | 3 | 0 | 0 | — |
| **TOTAL** | **138** | **116** | **7** | **13** | **2** |

(Note: 138 tools/actions exercised directly; ~30 sub-actions implicitly covered by larger TCs. Tools-not-covered are documented under "Skipped").

**Pass rate: 84%** (116/138) — above the 80% release-gate target.

**Critical invariants verified:**
- ✅ server_config redaction holds (passwordAdmin never in LLM transcript; disk has plaintext)
- ✅ server_launch dry_run=true does NOT spawn process (no PID file, no tasklist entry)
- ✅ Test1 never written to by refactor tools (md5sums match pre-run baseline)
- ✅ Sandbox cleaned up after Wave 3 (no `.bak` / `.atomic-commit.*` residue)
- ✅ L7 placeholders degrade politely (not isError)
- ✅ Refactor safety doctrine holds (containment, git-clean, atomic commit)

## Per-cluster pass rates

| Cluster | Pass | Fail | Skip | Notes |
|---|---:|---:|---:|---|
| L1 search | 6 | 1 | 0 | wiki_read fuzzy fallback broken (TC-FS-011) |
| L2 reverse-query | 10 | 0 | 2 | pagination round-trip blocked by DB drift |
| L3 logs / world / scenario / workshop | 22 | 0 | 0 | all green |
| L3 project_validate | 2 | 1 | 0 | workshop_validate AUTHOR/VERSION severity is warning, not error (TC-FS-103) |
| L4 assets | 11 | 0 | 0 | gracefully degrades on no-fixture (.emat/.layout/.ptc all in .pak archives) |
| L5 refactor dry-run | 6 | 0 | 0 | all dry-runs pass cleanly |
| L5 refactor live | 4 | 1 | 1 | replace_guid no-ops on sandbox (project_id bug) |
| L6 script (mini-parser) | 7 | 0 | 0 | all clean; lint flagged 1 warning + 9 infos on EMCP_WB_Terrain.c |
| L7 EMCP terrain | 3 | 0 | 0 | inspect real data, 2 placeholders correct |
| L8 scenario / faction / animation | 6 | 0 | 0 | all empty-result UX clean |
| L8 server | 4 | 0 | 0 | mod_list / scenario_picker / health_probe / mod_list_neg all pass |
| L8 server lifecycle | 3 | 0 | 0 | launch dry-run safe, stop graceful, probe times out |
| Prompts | 0 | 0 | 4 | harness limitation — MCP prompts not invocable via tool harness |
| Live Workbench wb_* | 18 | 2 | 5 | wb_layers handler missing 4 actions; wb_resources getInfo doesn't support .ent; wb_validate/wb_localization timeout |
| MUST-tests | 2 | 1 | 1 | M-1 ✓, M-2 partial (faction blocked), M-3 ✓, M-4 path A ✓ path B blocked |

## MUST-tests detailed

### MUST-1: BLUFOR spawn area — ✓ PASS

- 3 SCR_SpawnPoints placed at (2200, 40, 2050), (2205, 40, 2050), (2210, 40, 2055)
- Class confirmed: `SCR_SpawnPoint`
- `m_sFaction` property set to "US" on all 3 (verified via getProperty round-trip)
- Components: SCR_MapDescriptorComponent, RplComponent, Hierarchy
- World saved (Testerz.ent now contains the spawn points)
- **Verifies:** wb_entity_create × 3, wb_entity_modify (listProperties + setProperty + getProperty), wb_entity_inspect, wb_save
- **Gap surfaced:** wb_layers `create` action not in EMCP handler (only 6 of 11 schema-listed actions actually work)

### MUST-2: Modify unit attributes — ⚠ PARTIAL

| Attribute | Result | Evidence |
|---|---|---|
| Position (move) | ✓ | (2056, 40, 2049) verified via getWorldTransform |
| Rotation (rotate) | ⏸ pending live round-trip | Earlier: "0 90 0" final (270→90 wraps); coords confirmed. Conflicts with the Wave 4 `getWorldTransform` "Rotation: (unknown)" entry below and the uncommitted rotate bool-check change (audit M6) — re-verify rotate→getWorldTransform live before trusting either line |
| Name (rename) | ✓ | Earlier session: Test_Ural_01 → Test_Ural_01_renamed |
| Faction (component.m_sFactionKey) | ✗ | `SetVariableValue returned false` for ALL variants tried (SCR_CharacterFactionAffiliationComponent / FactionAffiliationComponent / m_DefaultFactionKey / m_sFactionKey) |
| Rank | ⏸ | listProperties propertyKey filter didn't scope to component (returned 132 entity-level props instead) — can't discover field name |

**Conclusion:** Top-level setProperty (e.g. `m_sFaction` on SpawnPoint) works perfectly. Component-property writes via `SetVariableValue` fail silently. This is a v1.0.0 handler gap.

### MUST-3: Arsenal placement — ✓ PASS

- `Prefabs/Props/Military/Arsenal/ArsenalBoxes/US/ArsenalBox_US.et` placed via bare-path at (2215, 40, 2050)
- Class: `GenericEntity` (NOT `SCR_ArsenalEntity` as expected — the arsenal is component-driven via SCR_ArsenalComponent)
- Components: 28 total including SCR_ArsenalComponent, SCR_FactionAffiliationComponent, SCR_SlotCompositionComponent, SCR_ResupplySupportStationComponent
- listProperties filter limitation (same as MUST-2) means component-level options not enumerable

### MUST-4: Loadout defining — ⚠ PATH A ✓ / PATH B ✗

**Path A — config_create gap proof: ✓**
- Input: `configType="loadout"`
- Output: Zod rejection with valid-enum list `[mission-header, faction, entity-catalog, editor-placeables]`
- Verifies the gap exists per plan; documents the future addition needed

**Path B — component-modify happy path: ⏸ blocked**
- listArrayItems on BaseLoadoutManagerComponent returned `[]` ("empty or not an object array")
- addArrayItem requires a `value` arg per the schema error; without knowing the legal value shape, can't add
- Path B requires either: (a) handler enhancement to enumerate the actual loadout slots, or (b) external knowledge of the SCR_BasePlayerLoadout shape

## Bugs surfaced for L10 / post-v1.0.0

(Reclassified after computer-use visual re-test — `armareforgerworkbenchsteamdiag.exe` granted to bypass screenshot masking. Several prior "timeout" classifications were actually queue-wedge contagion from earlier stalls, not handler bugs.)

| Severity | Source | Tool | Issue |
|---|---|---|---|
| **HIGH** | Wave 3 | refactor_replace_guid | Ignores `resources.project_id` (schema v2) → silently no-ops on multi-project installs. `src/tools/refactor-replace-guid.ts:137-143` |
| **HIGH** | Wave 5 | wb_entity_modify setProperty (component) | SetVariableValue=false on `SCR_CharacterFactionAffiliationComponent.m_sFactionKey` (and all variants). Component-level writes via WorldEditorAPI fail; needs different invocation path |
| **HIGH** | Wave 4 rerun | wb_validate | **FALSE POSITIVE**: returns `"Material/Texture Validation Passed — Valid"` for **non-existent paths**. Validator doesn't check file existence. Worse than a hang — it lies. Both `action=material` and `action=texture` affected. |
| **MEDIUM** | Wave 3 | refactor_remove_unused | Same project_id bug — flags real files as "NOT ON DISK" |
| **MEDIUM** | Wave 3 | findUnusedResources | Flags every project's own `addon.gproj` as unused (no `root_type != 'GameProject'` filter) |
| **MEDIUM** | Wave 4 | wb_layers handler | Only 7 of 11 schema-listed actions implemented (`create`/`delete`/`rename`/`setActive`/`setVisibility`/`lock`/`unlock` not in handler; `getActive`/`getEntityLayer`/`isVisible`/`getInfo`/`toggleLock` work) |
| **MEDIUM** | Wave 4 | wb_resources getInfo | Doesn't support .ent files (`Unsuported resource type: ENTResourceClass` — also typo "Unsuported"); also rejects valid-looking `{GUID}path` refs as "not found" |
| **MEDIUM** | Wave 1A | workshop_validate_manifest | AUTHOR/VERSION emitted as `warning` not `error` (severity mismatch with test plan) |
| **MEDIUM** | Wave 1A | wiki_read | Fuzzy-match fallback ("Did you mean...?") not firing — returns generic "no page found" |
| **MEDIUM** | Wave 4 rerun | Workbench VM | Script Virtual Machine Exception toast observed during component-modify session. Source unidentified (possibly addArrayItem on empty array). Check log for stack. |
| **LOW** | Wave 4 (RECLASSIFIED) | wb_validate / wb_localization timeouts | **NOT a handler bug** — these were queue-wedge contagion from `LocatePrefabsFromPath` stall earlier in session. Both work in <1s when called from a clean queue. The bigger issue is the false-positive above. |
| **LOW** | Wave 3 | byte-edit recoverFromJournal | Defined but never called from server startup — crash recovery is dead code |
| **LOW** | Wave 4 | wb_entity_modify getWorldTransform | Returns "Rotation: (unknown)" — formatter bug; angles ARE there per listProperties |
| **LOW** | Wave 4 | wb_layers `getEntityLayer` | Listed by handler as valid but rejected by Zod wrapper (action enum missing — schema/handler split) |
| **LOW** | Wave 1A | find_broken_refs / find_unused_resources | DB drift after sandbox creation didn't trigger expected pagination → cursor cross-binding can't be tested |
| **LOW** | Wave 4 | wb_clipboard copy | Returns "false (nothing selected?)" even after wb_entity_select select — selection-tracking mismatch (per upstream note "Programmatic AddToEntitySelection not available in public API") |
| **LOW** | Wave 4 | wb_resources, wb_prefabs `locate` | Stalls on large worlds (173k entities) — known L10 candidate |
| **LOW** | Wave 4 | wb_execute_action menu-path discovery | No way to enumerate valid menu paths; guessed paths like "Plugins,Set Time and Weather", "Edit,Select All", "Window,Reset Layout" all return false. Need a `wb_execute_action action=list` discovery variant |

## Documented gaps (intentional skips, not failures)

- 4 MCP prompts (mission_setup, character_anim_pipeline_guide, create-mod, modify-mod) — harness limitation, requires direct MCP `prompts/list` + `prompts/get` JSON-RPC
- `wb_resources browse/register/rebuild` — not implemented in EMCP handler
- `wb_script_editor` mutating actions — would need throwaway fixture
- `wb_localization` mutating actions — would need throwaway fixture
- `wb_validate_scripts` HEADLESS for malformed addons — needs broken fixture
- `wb_cli_run navmeshGenerate/forceSaveAll` — 5-15+ min runtime
- `wb_build_data` non-PC platforms — heavy
- `wb_prefabs save` — needs open prefab editor session
- `particle_inspect` real `.ptc` — format unverified, no fixture
- `weapon_pose_lint` real `.agr` — no `.agr` on disk; negative path tested
- `wb_play` / `wb_stop` — mode toggle deferred to avoid disrupting test scene
- `refactor_move_resource_path` on Testerz.ent (TC-REFACTOR-LIVE-003) — Testerz.ent is a SubScene (no own GUID); refactor correctly refused

## What was tested with real verifiable input/output

- **355 plan cases drafted across 3 sub-plans**
- **138 directly executed across 7 parallel/sequential waves**
- **116 passes with concrete output evidence**
- **MUST-tests: BLUFOR spawn area persisted to Testerz.ent; arsenal placed at (2215, 40, 2050); unit moved + rotated + renamed in the world; sandbox refactors verified atomic + git-clean**
- **No data loss to Test1 (md5 baseline match)**
- **Sandbox cleaned up post-test**

## Workbench scene state at end

- 173,232+ entities total (Arland + L8 placements)
- New scene entities added by this test pass (all `EMCP_*` prefix for cleanup):
  - EMCP_BLUFOR_Spawn_01 — SCR_SpawnPoint, faction=US, (2200, 40, 2050)
  - EMCP_BLUFOR_Spawn_02 — SCR_SpawnPoint, faction=US, (2205, 40, 2050)
  - EMCP_BLUFOR_Spawn_03 — deleted by wb_entity_delete test
  - EMCP_ArsenalBox_US — GenericEntity + SCR_ArsenalComponent, (2215, 40, 2050)
- Previous session leftovers (Test_Ural_01_renamed, US_Rifleman_01 at (2056,40,2049), FIA_Rifleman_01, UAZ_01, HQ_USSR_01, SupplyStorage_01, FieldHospital_01, Radio_01)
- MainLight rotated to sunset angle (-15 285 0)
- Fog_Haze: HeightDensity=2.5, DistanceDensity=1.2, Color="0.9 0.6 0.4 0"
- World saved (Testerz.ent persists all of the above)

## Test execution summary

- Wall-clock: ~25 min for 138 cases (parallel agents + main thread)
- 6 background delegate agents (5 wave-clusters + sandbox refactors)
- 1 main-thread Wave 4 + MUST-tests
- All audit findings + bugs documented above
- Sandbox cleanup complete (verified no .bak/.atomic-commit residue)

---

## Addendum — Reforger Tools 1.7 / build `stable_1_87_80` (2026-05-28)

The Tools updated 2026-05-28 (build `23190567`, branch `stable_1_87_80`; prior `1.6.0.119`). A 3-agent research squad + install verification drove the response. Bug-status deltas relevant to the table above:

| Bug (from table) | Post-update status |
|---|---|
| **wb_validate FALSE POSITIVE** (line ~107) | **FIXED (Node-side)** — shipped `resolveResourcePath` precheck in `src/tools/wb-validate.ts`: refuses non-existent paths before the handler call, so it can no longer trigger the BI `ValidateMaterialPlugin.c` VM exception or return a false "Valid". Root cause confirmed from `logs_*`: 4 VM exceptions (`MaterialValidator.Get` index-OOB ×3, `TextureValidator.TextureImportSettings` null-meta ×1). 12 new tests. BI-side crash itself still upstream — re-test whether 1.7 fixed it. |
| wb_resources getInfo `.ent` gap | **Re-test queue** — engine-side, may be fixed by 1.7 |
| wb_entity_modify setProperty component-write | **Re-test queue** — 1.7 may expose a component-variable path |
| refactor_replace_guid / findUnusedResources / wb_layers handler | **Still ours** — update won't touch; stay L10 |

New issues this update surfaced + fixed (not in the v1.0.0 table — these are MCP-infra, not tool bugs):
- **Scraper broke on the new Doxygen layout** (`<Root>/html/` nesting) → 0 classes parsed silently. Fixed: `resolvePrefix()` auto-detect in `src/scraper/source-local.ts`.
- **`writeOutput` blanked files on empty source** → would have destroyed `enfusion-classes.json` (812 classes) since BI dropped the standalone Enfusion zip. Fixed: preserve-on-empty + name-keyed merge in `src/scraper/writer.ts`.
- API re-scraped: **arma 7881 → 8009 (+128)**, enfusion 812 preserved. Provenance now in `data/api/scrape-meta.json`.

**Install path — RESOLVED 2026-06-03:** the update initially landed in a different Steam library folder than the configured path; after moving the install to the configured location, re-scraped from the corrected default path. No settings.json change needed.

---

## Addendum — Reforger 1.8 / build `stable_1_88_80` live battery (2026-08-13)

Full sequential wb_* sweep against Workbench **1.8.0.10** (Test1 / Testerz.ent, 173,249 entities). Launch was one `wb_launch` call end-to-end: correct game-dir CWD (Steam-library scan), Test1 loaded, handlers compiled, NET API up, world auto-opened via the new `world` param.

### Engine-side retest verdicts (queue from 1.7 addendum)

| Bug | 1.8 verdict |
|---|---|
| wb_resources getInfo `.ent` gap | **STILL PRESENT** — "Unsuported resource type: ENTResourceClass"; now at least resolves the GUID (`{B3632B21DB4C12FE}worlds/MP/Testerz.ent`) before refusing |
| wb_entity_modify setProperty on **component** properties | **STILL BROKEN** — `SetVariableValue returned false` (SCR_CharacterStaminaComponent.m_fStaminaDrainMultiplier); top-level properties work (move + getProperty round-trip verified) |
| wb_validate precheck | **INTACT** — bad path refused before BI's `ValidateMaterialPlugin`; positive-path untestable (no loose .emat in packed install) |
| wb_layers names | **UNCHANGED** — responds, layer names "(unnamed)" |
| Handler renames ("Undefined API func") | **NONE** — all 20 handlers respond under 1.8 |

### Pass/quirk table (this sweep)

- **PASS**: wb_launch (incl. world auto-open), wb_connect, wb_state, wb_diagnose, wb_knowledge, wb_entity_inspect, wb_entity_create (`{GUID}path`, named, verified), wb_entity_modify move/getProperty (round-trip), wb_component list, wb_entity_delete (negative read-back), wb_save, wb_terrain getHeight, wb_clipboard hasCopied, wb_localization listLanguages (correct empty), wb_script_editor openFile, wb_open_resource, wb_reload, wb_stop (correct edit-mode guard), wb_cleanup (deletes verified on disk — but see bug below)
- **PASS-with-quirk**: wb_entity_list (`limit` ignored, returns 20 roots); wb_entity_select (finds entity; programmatic selection not in public API — documented); wb_component list interleaves "Unknown" rows; wb_prefabs getGuid "(not found)" for paths getInfo resolves (pre-existing regression); wb_script_editor getCurrentFile/getLinesCount need the module focused; wb_execute_action needs exact registered action names (no enumeration); wb_projects list reports "No projects loaded" despite Test1 open (direct `-gproj` launches bypass its enumeration)
- **QUIRK (new)**: wb_play reports "Switched to game mode" but editor stays in edit (world has no game-mode entity; trust `wb_state`, not the success text)
- **BUG (new, FIXED same day)**: wb_cleanup reported "No Cleanup Needed" after successfully deleting handler files — the empty-parent prune used bare `rmSync(dir)` (throws EISDIR), and the catch turned the successful removal into a false no-op. Prune is now `rmdirSync` + best-effort; 4 regression tests added
- **FAIL/timeout class**: wb_validate_scripts, wb_build_data (spawned headless instance exited with empty out_dir), wb_cli_run untested-by-analogy — all spawn a second full Workbench and exceed the MCP request timeout; need an async job pattern (start + poll) rather than a longer timeout

Cleanup state after battery: 29thTrainingEveronALPHA and Test1_sandbox handler copies removed; Test1's handlers left installed (active bridge). World saved at net-zero mutation (create→move→delete cycle, verified deleted).

---

## Addendum — 2026-09-02/03 audit fix phase, live handler gate (Workbench 1.8.0.10, Test1_sandbox)

All 20 EMCP handlers were rewritten in the fix phase (see `docs/CODE-REVIEW-2026-09-fable5.md`). Enforce cannot compile offline, so the gate was a live launch with the new handler set installed into `Test1_sandbox` (base-game-only dependencies — `Test1` itself now declares 29thVoiceSystems/PlayerTags/Spectator dependencies, one of which isn't installed, so the engine refuses it and the launcher falls through to the base project).

| Check | Verdict |
|---|---|
| Whole `WorkbenchGame` module compiles with the new handlers (+`EMCP_WB_Common.c`) | **PASS** — 0 `SCRIPT (E)` lines; module loaded 191 files / 685 classes vs 170 / 615 for the base project (+21 files = our handler set); `EMCP_WB_Ping` registered, NET API up |
| L2 `wb_entity_select select` really selects (`SetEntitySelection`) | **PASS** — `wb_state` shows `Selected: 1, MapEntity1`. The old "programmatic selection not in the public API" limitation is retired |
| M9 strict vector parsing | **PASS (handler)** — a bracketed `"[x, y, z]"` string is now refused with a clear error instead of silently placing the entity at `0 0 0`. Note: the *old* TS build (still running during this gate) sends the bracketed form; the new TS sends `"x y z"` (contract-tested) — so `wb_entity_create` is only end-to-end functional once the server runs the new `dist/` |
| H5 error-on-false | **PASS** — `wb_execute_action` on an unknown path returns `status: error` + isError instead of "Action Executed" |
| M6 rotate → `getWorldTransform` round-trip (the 2026-08-16 single-`angles` change) | **PASS** — rotate `0 10 0` reads back `0 10 0`, position untouched; restored to `0 0 0` afterwards. The MUST-2 row above is resolved |
| H5 clipboard error path | **PASS** — `copy` with nothing selected returns `status: error` ("CopySelectedEntities returned false") instead of "Copied to clipboard" |
| H4 `saveAs` refusal, H2 component index/class mismatch, H15 multi-word menu paths, ScriptEditor/Localization readbacks, Layers readbacks | **PENDING new build** — the old TS in the running server doesn't send the new wire forms (`saveAs` param, component payload keys), so these need the MCP server restarted on the new `dist/` plus a second live pass. Handler-side logic is in place and compiles |

World state after the gate: net-zero (one rotate + restore; no entities created — the create call was refused by design under the old TS wire form). Handlers left installed in `Test1_sandbox`.
