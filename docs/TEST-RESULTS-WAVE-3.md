# Wave 3 results — live refactors against Test1_sandbox

## Setup
- Sandbox path: `C:\Users\<you>\Documents\My Games\ArmaReforgerWorkbench\addons\Test1_sandbox`
- Baseline GUID: `6968F5564CA31D9E`
- Baseline ID: `Test1_sandbox`
- Baseline git log: `b97b153 rename sandbox project id` → `7a60d18 sandbox baseline`
- Sandbox indexed by MCP at run-time (last scan 4 minutes ago at start)

## Summary
- Total: 6 + 1 bonus = 7
- Passed: 4 (TC-001, TC-004, TC-005, TC-006*, TC-WBROLLBACK)
- Failed: 1 (TC-002 — real bug surfaced in `resolveAbsPath`)
- Skipped: 1 (TC-003 — test premise didn't match indexable-resource contract)
- *TC-006 is a partial: tool contract met, but underlying script generation has a relative-path bug

## Critical invariants verified
- [x] All refactors leave .bak sidecars (verified for TC-001; TC-002/004/005 were no-ops so no .bak expected)
- [x] No journal files (`.atomic-commit.*.json`) left behind in sandbox at end
- [x] No `.bak` files in sandbox at end
- [x] Sandbox parses cleanly via `parseEnfusionText` (verified post-TC-001)
- [x] Real Test1 UNTOUCHED — md5sums for `addon.gproj`, `worlds/MP/Testerz.ent`, `UserMaps.desc` match pre-run baseline

## Cases

| TC ID | Tool | Result | Notes |
|---|---|---|---|
| TC-REFACTOR-LIVE-001 | refactor_rename_project_id | PASS | ID line swapped `Test1_sandbox`→`Test1_sandbox_renamed`. `.bak` sidecar at `addon.gproj.bak`. No journal residue. Parser reports clean AST with new ID. |
| TC-REFACTOR-LIVE-002 | refactor_replace_guid | FAIL | Returned "no matches" despite the GUID existing in `addon.gproj`. Real bug in `resolveAbsPath` (src/tools/refactor-replace-guid.ts:137-143) — function unconditionally returns the FIRST project's resolution from a list sorted by `length(root_path) DESC`. For sandbox the first project becomes a workshop mod's project (longest root_path), so it reads that .gproj instead of Test1_sandbox's. The fix: use the `resources.project_id` column (schema v2) to look up the correct `root_path`. Comment at line 130-133 admits the limitation. Side-effects: none (zero matches → no atomic commit attempted → no `.bak`, no journal). |
| TC-REFACTOR-LIVE-003 | refactor_move_resource_path | SKIP | Sandbox's `worlds/MP/Testerz.ent` is a SubScene (no own GUID), correctly classified as `unindexable` by the resource scanner. The refactor requires the file be in the `resources` table. Tool refused cleanly with "No resource indexed at worlds/MP/Testerz.ent. Crawl your project first." — accurate message, correct behavior. Test premise needs adjustment: pick an indexable resource (a `.et`/`.layout`/`.conf` with its own GUID) for future runs. |
| TC-REFACTOR-LIVE-004 | refactor_normalize_dependencies | PASS | Tool reports "Already canonical — sorted + deduped, no changes needed" against the single-dep sandbox. No file mutation. No `.bak`. No journal. Sandbox unchanged. |
| TC-REFACTOR-LIVE-005 | refactor_merge_duplicate_guids | PASS | Diagnose-only. "Scanned 2 resource files. No duplicate GUIDs found." Sandbox unchanged. |
| TC-REFACTOR-LIVE-006 | refactor_remove_unused | PARTIAL PASS | Dry-run-only contract met: emitted a 2-file removal script. **Two issues** in the output: (1) Both Test projects' `addon.gproj` are flagged as "unused" because they have no inbound refs (no one references the project's own GUID — same root cause as TC-002). (2) Both are also flagged as "NOT ON DISK" — comment-only marker, but the existence check uses the bare relative path (`existsSync(row.file_path)` at refactor-remove-unused.ts:179) instead of resolving against the owning project's `root_path`. Comment at line 169-173 admits the heuristic limitation. |
| TC-WBROLLBACK-001 | atomicCommit (code-review) | PASS with finding | Code review of `src/refactor/byte-edit.ts`. Atomic-commit flow is correctly designed: Phase 1 backup → Phase 2a journal write → Phase 2b stage tmps → Phase 2c rename tmp→target → Phase 3 mark journal completed + delete. Rollback paths are explicit at every phase: stage-fail cleans tmps and journal; rename-fail restores from `.bak` for already-renamed targets, cleans remaining tmps, drops journal. The `recoverFromJournal` function exists for crash-recovery but **is never called from anywhere in the codebase** (`grep recoverFromJournal src/` = 1 hit, the definition itself). Recovery requires manual invocation — if the MCP server crashes mid-commit, a stale journal will remain on disk indefinitely. Recommended: wire `recoverFromJournal(projectRoot)` into the project-index crawler at startup. |

## Bugs surfaced (priority order)

1. **HIGH — `resolveAbsPath` in `refactor-replace-guid.ts` is broken.** Always returns the first project's resolution, regardless of which project owns the file. Schema v2 already added `resources.project_id`; the function should join on it. This causes `refactor_replace_guid` to read the wrong file's content, finding 0 matches → silently no-op. Affects every multi-project install.

2. **MEDIUM — `refactor_remove_unused` uses relative path against cwd for existence check.** Line 179 of `refactor-remove-unused.ts` calls `existsSync(row.file_path)` — `row.file_path` is project-relative. The check passes only when the MCP server's cwd happens to be the owning project root. Same fix applies: resolve via `resources.project_id` → `projects.root_path`.

3. **MEDIUM — Project-self GUID flagged as "unused" by `findUnusedResources`.** Every project's own GUID is flagged unused because no resource references it (refs point AT files, not at the project root). The `addon.gproj` rows shouldn't be candidates for removal — the unused-detector should exclude `root_type = 'GameProject'`.

4. **LOW — `recoverFromJournal` not auto-invoked on server startup.** Crash-recovery is dead code without a startup hook. Wire into `crawler.ts` or server bootstrap.

## Sandbox final state

```
$ git -C sandbox status
On branch master
nothing to commit, working tree clean

$ git -C sandbox log --oneline
b97b153 rename sandbox project id
7a60d18 sandbox baseline

$ ls sandbox
.git  Missions  Scripts  UserMaps.desc  addon.gproj  resourceDatabase.rdb  worlds

$ find sandbox -name '*.bak' -o -name '.atomic-commit.*' -o -name '*.tmp.*'
(empty — no residue)
```

## Real Test1 final state (untouched safety check)
```
$ md5sum Test1/{addon.gproj,worlds/MP/Testerz.ent,UserMaps.desc}
4b242781fe27a9bad31c72a4c0689fed  Test1/addon.gproj             # matches pre-run
c294a51a9c3c567c87113899e426a7bf  Test1/worlds/MP/Testerz.ent   # matches pre-run
1afa008e7c803b009aab4b3fa099fe05  Test1/UserMaps.desc           # matches pre-run
```

## Patterns observed

- The schema-v2 `project_id` column was added to the `resources` table but at least two tools still treat it as if it weren't present (TC-002 finding, TC-006 finding). A pass to retrofit all callers of `resolveAbsPath`-style heuristics with proper project-aware resolution would unblock multi-project refactor workflows.
- The "unused resources" detection has a known false-positive on project-self GUIDs that surfaces as soon as the index contains more than one project. Worth a `WHERE root_type != 'GameProject'` filter in `findUnusedResources`.
- Crash-recovery is wired to be invocable but isn't actually invoked anywhere. Recommend an L4 follow-up to call `recoverFromJournal` from server bootstrap.
- `SubScene` `.ent` files (and other `UNINDEXABLE_ROOT_TYPES`) cannot participate in `refactor_move_resource_path` because they're absent from the `resources` table by design. The future test plan for live refactors should pick an indexable resource (`.et`/`.layout`/`.conf` with its own GUID) for the move case.
