# Total audit — 2026-09-02 (Claude Fable 5.1)

Baseline commit `1087c9a` (plus uncommitted rotate change in `EMCP_WB_ModifyEntity.c`). Ten read-only audit workers (one per subject, identical audit pattern: correctness / security / error handling / contract drift / dead code / test gaps) plus a supervisor synthesis; the four load-bearing claims (C1, H1, H15, M24) were re-verified by hand in the main session. Prior review: [CODE-REVIEW-2026-06-fable.md](CODE-REVIEW-2026-06-fable.md).

**Totals: 2 CRITICAL · 18 HIGH · 26 MEDIUM · 8 LOW bundles.** 37 new rows; 17 re-confirmations of June open items (tools-live-3/4/5/7/10, emcp-1/3/6/8-half, RBE-5/7/9, SEC-NEW-02/03, cs17-2/6, dd-04/05, FS-1, ARCH-2, dead JobStore). Marked FIXED since June: tools-live-1, RBE-1, RBE-8, FMT-1 (partially — see C1).

## Convergence (≥2 workers independently)

- **TS reads keys the handlers never emit** (w1, w2, w8): entity_select `selected` vs `selectedEntities`; entity_list `total` vs `totalCount`; entity_create `name/id` vs `entityName/entityClass`; entity_duplicate `value` vs `message`; terrain getBounds `minX..` vs `boundsMin/Max`; layers `path||name` vs `layerID` only; inspect formatter reads prefab/layerPath/children. The w8 action/response-key inventory (appendix) is the ground truth.
- **Handlers return `status:ok` on void/false engine calls** (w1, w2, w8 — 11 of 20 files). TS-side `isHandlerError` cannot fix this; the `.c` must check the bool.
- **saveAs overwrites the current world** (w1, w2, w8): `EditorControl.c:80-86` calls plain `Save()`, TS prints "Saved as: <path>".
- **tools-live-3 (no isHandlerError) still open** in wb-editor, wb-launch openResource, wb-prefabs, wb-localization, wb-projects, wb-terrain, wb-reload (w1, w2).
- **Write-tool containment never back-ported to the upstream-inherited Phase 0–3 tools** (w5, w6, w7): project / prefab / config_create / mod create / building_setup / server_config / script_create / scenario_create / refactor_move `new_path` / rename_project_id / normalize_dependencies `gproj_path`. Handler-side twin: `Prefabs.c` createTemplate `MakeDirectory` on a raw path (w8).
- RBE-5 / RBE-7 / RBE-9 / dead JobStore still open (w5, w6, w2).
- **A stale `.claude/worktrees/` copy is collected by vitest** (no `vitest.config`) — suite reports 2216 tests vs ~1108 real (w9, w10).
- `tests/animation/integration-m151a2.test.ts` is dead: hardcoded path, always skipped, tautological asserts (w7, w10).
- `vfs normalizePath` doc says lowercase, isn't → pak lookups case-sensitive vs loose case-insensitive (w4, w6).
- `readTextFileBounded` not adopted by boot crawlers / most tools (w5, w6).
- Parser fixture gaps: no `const` / `#ifdef` / generic Enforce cases (w7, w10); no CRLF / BOM / hex fixture for enfusion-text (w4, w10).
- Zero tool-level tests for wb_* and most write tools (w1, w2, w6, w10).

## Dissent (resolved)

1. **ExecuteAction trimming.** w1: handler trims each comma segment so `" File,Close"` bypasses the TS `startsWith` blocklist. w8: `part.Trim()`'s return is discarded (Enforce `Trim()` is non-mutating; `TrimInPlace()` is in-place). Source confirms w8 — so no real bypass, but multi-word menu paths silently fail with status ok.
2. **path-guard symlink/junction.** w10: CRITICAL; w5: LOW. w5 is right for the threat model (LLM-supplied paths, not a hostile project tree): MEDIUM hardening item.
3. **wb_projects wire key.** w2's `"Loaded Projects"` claim rests on a test mock only → kept HIGH on the verified half (TS reads keys that are not emitted), exact key flagged LIVE.

## Non-obvious finds

- **FMT-1 fix is incomplete (C1).** `isNumericToken` rejects hex (`0x3`) and exponent floats, so `Flags 0 0x3` / `coords …` collapse into bogus key/values and the serializer writes them back corrupted. 167 / 3,000 real game files (5.6%) affected; 37 importers including the scenario and refactor writers. June's fix was validated only on the review's two literal examples. Reproduced in-session:
  `Flags 0 0x3` + `coords 79.022 2.001 230.457` → `Flags 0` / `0x3 "coords"` / `79.022 2.001 230.457`.
- **Path-keyed index with no project_id (C2)**, probed: same-named files across addons overwrite each other's rows; watcher unlink deletes both; replace_guid picks an arbitrary owner → silent partial refactor. Single root of five downstream defects; schema v3 closes them together.
- `script_lint` reports "Clean" over a mangled AST (w7, executed): `parseMember` emits phantom fields for `const` / `static` / `ref map<>` / `#ifdef`; lint never reads `ast.diagnostics`.
- `wb_build_data` omits `-wbModule=ResourceManager` (BIKI-backed) — plausible root cause of the 2026-08-13 empty out_dir.
- Headless tools exceed the MCP client window (180–600 s defaults, no progress notifications); an abandoned child runs up to 30 min invisibly.
- `wb_component remove`: index wins over class — `remove RigidBody index 0` deletes component #0, reports "Removed RigidBody".
- `wb_entity_duplicate` creates the copy at the origin, then deletes the original (reads `value`; handler returns the position in `message`). API-driven edits do not register on the editor undo stack.
- `remove_unused` generated cmd script: `REM` mid-line isn't a comment → `del` receives extra filenames.
- The anim-pipeline prompt promises 8 KB files `wb_knowledge` can never return (not in `index.json`).
- `GetEntity` uses `GetDefaultAsString` → inspect shows prefab defaults, not instance values; disagrees with `listProperties`.
- Socket `'end'` path calls `removeAllListeners` without `destroy` → a late ECONNRESET is an unhandled `'error'` → MCP process crash (w3); same class as `server_launch` spawn with no `'error'` listener (w7).
- PII: a home-directory path with the maintainer's username in `cli-runner.ts:15` and `tests/tools/wb-validate-scripts.test.ts:24` of the public tree.

## Consolidated findings

| ID | Sev | file:line | Defect | Failure scenario | Workers | Verif | Conf |
|---|---|---|---|---|---|---|---|
| C1 | CRITICAL | src/formats/enfusion-text.ts:75-77,389-393 | isNumericToken rejects hex/exponent tokens | `Flags 0 0x3`+`coords` lines parse to bogus keys; serialize corrupts 5.6% of real files via 37 importers incl. scenario/refactor writers | w4 (+main repro) | OFFLINE | high |
| C2 | CRITICAL | src/project-index migrate.ts:37-55, ref-scan.ts:54-64, watch/project-watcher.ts:121-123 | files/refs keyed by relative path, no project_id (schema-v3 deferred) | Same-named files across addons clobber rows; unlink deletes both; replace_guid/move resolve arbitrary owner → silent partial refactor | w5 (+w6 M4) | OFFLINE (probed) | high |
| H1 | HIGH | wb-entity-duplicate.ts:199-205,241 | reads `value`, handler returns pos in `message` | Copy spawns at 0 0 0, original deleted | w1 (+main) | OFFLINE | high |
| H2 | HIGH | EMCP_WB_Components.c:158-173 | componentIndex overrides componentClass | Wrong component deleted, TS reports the requested class | w1 | OFFLINE | high |
| H3 | HIGH | wb-entities.ts:40,100,108,113,532; wb-projects.ts:87-91; wb-terrain.ts:56-62; wb-layers.ts:86 | TS reads keys handlers never emit | Pagination hint dead, getSelected always errors, layerPath ignored, "No projects loaded", bounds JSON-dump | w1, w2, w8 | OFFLINE (wb_projects key: LIVE) | high |
| H4 | HIGH | EMCP_WB_EditorControl.c:80-86 + wb-editor.ts:135 | saveAs runs Save(), returns ok | Current world overwritten, "Saved as" lie (emcp-6 open) | w1, w2, w8 | OFFLINE | high |
| H5 | HIGH | 11 handler files (EditorControl.c:61-112, ExecuteAction.c:85, Clipboard.c:66-116, Reload.c:118, Resources.c:100-115, ScriptEditor.c:105-137, Localization.c:140,198, ModifyEntity.c:207,286, CreateEntity.c:133, Prefabs.c:158) | status ok on void/false engine calls | Every failed action renders as success | w1, w2, w8 | OFFLINE / LIVE to confirm | high |
| H6 | HIGH | wb-editor.ts:36-224, wb-launch.ts:98, wb-prefabs.ts:159-180, wb-localization.ts:71, wb-terrain.ts:40-43, wb-reload.ts:27, wb-projects.ts | no isHandlerError (tools-live-3 open) | handler status:error → "Resource Opened"/"Template Created"/"Height 0" | w1, w2 | OFFLINE | high |
| H7 | HIGH | project.ts:147-154, prefab.ts:284-300, config-create.ts:139-155, mod.ts:668-707, building-setup.ts:190-235, server-config.ts:116-160, script-create.ts:87-106, scenario-create.ts:212-228, refactor-move:74-75,245-246, rename-project-id:147, normalize-deps:173 | LLM-supplied root/path with no assertInsideRoot | Writes/renames anywhere on disk (building_setup via manifest `../`) | w5, w6, w7 | OFFLINE | high |
| H8 | HIGH | EMCP_WB_Prefabs.c:122-141 | MakeDirectory+CreateEntityTemplate on raw absolute path | Handler-side arbitrary write; TS never sends addonName | w8, w2 | OFFLINE | high |
| H9 | HIGH | wb-build-data.ts:140-147 | argv omits `-wbModule=ResourceManager` | GUI boots, nothing built, empty out_dir | w2 | LIVE (doc-backed) | med-high |
| H10 | HIGH | wb-build-data.ts:207, wb-cli-run.ts:259-269, wb-validate-scripts.ts:301-315 | no isError on failed verdict/timeout/non-zero; no artefact check | "Build complete" with empty out_dir | w2 | OFFLINE | high |
| H11 | HIGH | wb-validate-scripts.ts:182, wb-build-data.ts:63, wb-cli-run.ts:148, server.ts | 180–600 s defaults, no progress notifications | Client times out, child runs ≤30 min invisibly, retry spawns another | w2 | OFFLINE | high |
| H12 | HIGH | script-parser/parser.ts:231-298 | modifiers parsed as types → phantom fields, generics dropped | script_analyze/extract_interface/class_hierarchy wrong on most real files | w7 | OFFLINE (executed) | high |
| H13 | HIGH | script-lint.ts:161-177 | never reads ast.diagnostics | "Clean" verdict over mangled AST | w7 | OFFLINE (executed) | high |
| H14 | HIGH | server-launch.ts:187-194 | spawn without 'error' listener | EACCES → unhandled event → MCP process dies after reporting "spawned" | w7 | OFFLINE | high |
| H15 | HIGH | EMCP_WB_ExecuteAction.c:68,73 | Trim() result discarded | Multi-word paths (`Edit, Select All`) fail, status ok | w8 (+main) | OFFLINE | high |
| H16 | HIGH | src/prompts/character-anim-pipeline-guide.ts:94-97 + kb index.json | 8 KB files unindexed | Prompt directs model to content wb_knowledge can't return | w9 | OFFLINE | high |
| H17 | HIGH (hygiene) | .claude/worktrees/…, no vitest.config | worktree collected by vitest | Suite doubled (2216 vs ~1108); README count stale | w9, w10 | OFFLINE | high |
| H18 | HIGH | tests/animation/integration-m151a2.test.ts:21 | hardcoded path, always skipped, tautological asserts | Only e2e animation check is dead | w7, w10 | OFFLINE | high |
| M1 | MEDIUM | client.ts:869-940 | removeAllListeners on 'end' without destroy | Late ECONNRESET → unhandled 'error' → crash | w3 | OFFLINE | med |
| M2 | MEDIUM | client.ts:209-222 + wb-launch.ts:118-134 | ensureRunning joins in-flight launch regardless of gproj | Wrong project opened, "handlers installed" false success | w3 | OFFLINE | high |
| M3 | MEDIUM | client.ts:438-472 | recoverMissingHandlers no single-flight (tools-live-5 open) | Concurrent rmSync/copy race + N×30 s ping loops | w3 | OFFLINE | high |
| M4 | MEDIUM | client.ts:635-643 | timeout hint keyed on cliParamsSeen | Masks CONNECTION_REFUSED / NET-API hint | w3 | OFFLINE | high |
| M5 | MEDIUM | wb-execute-action.ts:29,60; Clipboard.c:66-107 + wb-clipboard.ts | ok+result:false rendered as success; dead `result.result` | "Copied to clipboard" with nothing selected | w1, w8 | OFFLINE | high |
| M6 | MEDIUM | EMCP_WB_ModifyEntity.c (uncommitted rotate diff), :204-207 | rotate now checks bool; move still raw value, ignores bool; TEST-RESULTS:73 vs :117 conflict | Needs live rotate→getWorldTransform round-trip before commit | w1, w8 | LIVE | med |
| M7 | MEDIUM | EMCP_WB_GetEntity.c:193 | GetDefaultAsString | inspect shows prefab defaults, not instance values | w8 | LIVE | med |
| M8 | MEDIUM | ModifyEntity.c:586-606,:542,:652,:304,:330 | removeArrayItem guard checks wrong container; emcp-1/emcp-3 open | VM crash surface on inherited-only arrays | w8 | LIVE | med |
| M9 | MEDIUM | EMCP_WB_CreateEntity.c:54-69, ModifyEntity.c:207 | ParseVectorString silent 0 0 0 on comma input | Entity at origin, status ok | w8 | OFFLINE | high |
| M10 | MEDIUM | EMCP_WB_Terrain.c:131 | world_path unescaped into JSON | Quote breaks Node parse | w8 | OFFLINE | high |
| M11 | MEDIUM | refactor-move-resource-path.ts:108,241-246 | RBE-5 open; refs resolved against caller root | EPERM leaves refs pointing at new path; cross-project refs silently skipped | w5, w6 | OFFLINE | high |
| M12 | MEDIUM | refactor-remove-unused.ts:51-76,114 | `REM` mid-line; NOT-ON-DISK lines still execute | del gets extra filenames; "Removed from script" false | w5 | OFFLINE | high |
| M13 | MEDIUM | refactor-normalize-dependencies.ts:33,56,94 | RBE-7 regex; non-GUID lines re-quoted; LF into CRLF | Corrupt .gproj on commit | w5, w6 | OFFLINE | high |
| M14 | MEDIUM | refactor-replace-guid.ts:106-119 | no source filter | Edits Steam-workshop files in place | w5 | OFFLINE | high |
| M15 | MEDIUM | byte-edit.ts:500-575,592,641; recoverFromJournal 0 callers | RBE-9 open; utf-8 round-trip; 2 git spawns/file | Non-UTF8 bytes → U+FFFD; journal unreachable; TOCTOU window | w5 | OFFLINE | med-high |
| M16 | MEDIUM | crawler.ts:172-192 | projects never deleted | Stale roots persist; CASCADE never fires | w5 | OFFLINE | high |
| M17 | MEDIUM | safe-read.ts callers (resource-scan:203, crawler:150, project.ts:119, asset-search:74, mod.ts, …) | readTextFileBounded not adopted | Large workshop .conf OOMs at boot | w5, w6 | OFFLINE | high |
| M18 | MEDIUM | game-duplicate.ts:74-93 | loose-files only, description promises pak | Stock-install workflow fails | w6 | OFFLINE | high |
| M19 | MEDIUM | mod.ts:657-861, game-read.ts:64-133, building-setup.ts:180,187, mode-gate refusals (tools-live-10) | error-shaped results without isError | Client treats failures as success | w6, w1 | OFFLINE | high |
| M20 | MEDIUM | server-mgmt/stop.ts:146-157, launch.ts:264-279 | PID-only identity | Stale pidfile → taskkill /F /T on foreign process | w7 | OFFLINE | high |
| M21 | MEDIUM | server-launch.ts:188 | stdio:"inherit" on stdio MCP | Child stdout corrupts JSON-RPC | w7 | LIVE | med |
| M22 | MEDIUM | pak/vfs.ts:219-249,257-276; formats/enfusion-text.ts:213-431,517-538 | legacy-pak branch unverified; zlib sniff no retry; unbounded recursion; non-byte-identical round-trip (850/3000) | Wrong bytes on stored entries (if hint wrong); RangeError on deep nesting; git noise on writes | w4 | OFFLINE | med |
| M23 | MEDIUM | tests/workbench/client.test.ts; path-guard.test.ts; tests/pak builders | no chunked-response, symlink, CRLF/BOM/hex, 1.8-pak-in-reader cases | Classic boundary bugs unguarded | w10, w4, w3 | OFFLINE | high |
| M24 | MEDIUM | cli-runner.ts:15, tests/tools/wb-validate-scripts.test.ts:24 | maintainer home path in public tree | PII / `<you>` convention violation | w9 (+main) | OFFLINE | high |
| M25 | MEDIUM | README.md:3,76,78,7,252 | 8,803 classes / 258 pages / 1,036 tests stale (8,971 / 274 / ~1,109) | Doc drift | w9 | OFFLINE | high |
| M26 | MEDIUM | mod.ts:536-553 | argv no `-` guard (SEC-NEW-02 open) | Flag injection via addonName | w6 | OFFLINE | high |
| L1 | LOW | client.ts:394-405, :583-628, :800; launch-watchdog.ts:93-96; steam.ts:40-42 | rmSync EnfusionMCP unchecked; 90 s can run 115 s; Ping.c-only skip; picker auto-Enter; Steam root off-by-one | — | w3 | OFFLINE | high |
| L2 | LOW | SelectEntity.c:130; Layers.c:194-241; CreateEntity.c; ModifyEntity.c:377-382; Terrain.c:149 | select clears then ok; ToInt→layer 0; no {GUID} guard; getProperty ignores bool; `not_implemented` vocab | — | w8 | OFFLINE | high |
| L3 | LOW | wb-layers.ts:17-29; wb-resources browse; wb-cli-run.ts:73-77,173-194; wb-validate.ts:189-192 | 7 unimplemented Zod actions (tools-live-4); dead validateTarget; cwd-relative targets; cs17-6 | — | w2 | OFFLINE | high |
| L4 | LOW | normalizeGuid ×4, FindEntityByName ×5+2, ParseVectorString ×2, walkers ×4, pak builders ×3, KILL_SETTLE_MS/killWorkbench, JobStore, clone-area.ts:89-137 workaround | duplicated/dead code | — | w1, w3, w5, w6, w7, w8, w10 | OFFLINE | high |
| L5 | LOW | server-redact.ts:264; scenario-clone-area.ts:88/187; scenario-picker.ts:64; logs-filter.ts:172; script-format.ts:68-71 | db uri passthrough; .et vs conf\|ent regex; dd-05/SEC-NEW-03/FS-1 open | — | w7 | OFFLINE | high |
| L6 | LOW | path-guard.ts:25; project-watcher.ts:73; migrate.ts:153-165; byte-edit.ts:751-760 | no realpath; watcher errors debug-only; dual-process v2 race; keepBackup:false deletes .bak | — | w5, w10 | OFFLINE | high |
| L7 | LOW | docs/L2-PLAN.md:74-75; README:259 case; scrape-meta.json:3 | env-var names stale; cosmetic; install path | — | w9 | OFFLINE | high |
| L8 | LOW | scraper/doxygen-parser.ts:45-60, index.ts:63-66 | no minimum-quality gate on scrape | Partial selector drift → 8k classes with empty methods | w4 | OFFLINE | med |

Dropped as [unverified]-only: wb_prefabs getGuid key shape; no-gproj picker ordering.

## Top-5 by leverage

1. **C1** — one tokenizer regex + a `Flags 0x1 0`/`coords` fixture, plus a corpus round-trip test gated on the game path.
2. **H5 + H6** — one `.c` convention (check every bool/void engine call) + one TS helper wiring `isHandlerError` everywhere.
3. **H7** — back-port `assertInsideRoot` to every Phase 0–3 write tool (and `Prefabs.c` handler-side).
4. **C2** — schema v3 (`project_id` on `files` + `resource_refs`), which also closes M11/M14/M16.
5. **H17** — a `vitest.config` excluding `**/.claude/**`, then refresh the README counts (M25).

## Appendix — handler action / response-key inventory (w8)

| Handler | Actions | Extra resp keys beyond status/message/action |
|---|---|---|
| Clipboard | copy, cut, paste, pasteAtCursor, duplicate, hasCopied | result |
| Components | add, remove, list | entityName, componentCount, components[{className,index}] |
| CreateEntity | — | entityName, entityClass, position |
| DeleteEntity | — | deletedName, deletedClass |
| EditorControl | play, stop, save, saveAs, undo, redo, openResource | — |
| ExecuteAction | — (menuPath) | menuPath |
| GetCameraPos | — | position |
| GetEntity | — (name \| index) | name, className, position, rotation, componentCount, layerID, subScene, varCount, properties[{name,value}], components[{className,index}] |
| GetState | — | mode, entityCount, selectedCount, currentSubScene, isPrefabEditMode, boundsMin, boundsMax, selectedNames[] |
| Layers | list, getActive, getEntityLayer, isVisible, getInfo, toggleLock | currentSubScene, layerID, layerVisible, layerLocked, layerActive, layerEntityCount, layers[{layerID,entityCount}] |
| ListEntities | — | totalCount, returnedCount, offset, entities[{name,className,position}] |
| Localization | insert, delete, modify, getTable, listLanguages | itemId, tableItemCount, entries[{id,en_us,target,comment}], languages[] |
| ModifyEntity | move, rotate, rename, reparent, setProperty, clearProperty, getProperty, listProperties, listArrayItems, addArrayItem, removeArrayItem, setObjectClass, getWorldTransform, makeVisible | entityName, properties[{name,type,value}] |
| Ping | — | mode |
| Prefabs | createTemplate, save, getAncestor | entityName, ancestorPath |
| Reload | — (target scripts \| plugins \| both) | — |
| Resources | register, rebuild, open, browse (always error) | path, entryCount, entries[] (never populated) |
| ScriptEditor | getCurrentFile, getLine, setLine, insertLine, removeLine, getLinesCount, openFile | currentFile, currentLine, linesCount, lineText |
| SelectEntity | select, deselect, clear, getSelected | selectedCount, selectedEntities[{name,className}] |
| Terrain | getHeight, getBounds, inspect (+7 L7 names → not_implemented) | height, boundsMin, boundsMax, payload |
