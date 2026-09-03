# Comprehensive MCP Review — 2026-06-03 (Fable model, ultracode)

Multi-agent adversarial review: 10 dimension finders → severity-weighted verification (3 lenses for high/critical, 1 refuter otherwise) → completeness critic → synthesis. **129 agents, 7.65M tokens.** Confirmed: **1 CRITICAL · 17 HIGH · 30 MEDIUM · 24 LOW** (72 total; 59 new, 13 verify-of-known). **10 claims refuted** (tested + dismissed). 5 completeness gaps surfaced 3 HIGH+ subsystems the scoped dimensions never read (pak/, watcher, resource error-convention).

**FMT-1 independently re-verified by main thread** (parse/serialize repro + real-file grammar check): real Enfusion `.layer`/`.ent` content + the project's own scenario template both use bare inline vectors that the parser mangles. CRITICAL stands.

---

## 1. Executive Verdict

Architecturally **sound but not release-ready**. The hardened spawn surface, NetApiHandler dispatch, project-index v2 schema, and the 1.7 `writeClassesPreserving` guard are genuinely solid. But: **one CRITICAL data-corruption bug** (Enfusion text parser mangles every entity transform on round-trip) + a HIGH cluster across three failure modes — silent data loss (per-project path-key mismatches, `.bak` clobbering, scraper merge collisions), a systemic tools-live error-UX flaw (handler failures rendered as successes), and an untrusted-binary attack surface (`pak/` zip-bomb) no dimension was scoped to read. Core abstractions hold; most findings localized. **Ship-blocked on FMT-1 + the HIGH cluster.**

## 2. Critical + High

| Sev | Area | File:Line | Issue | Fix | NEW/Known |
|-----|------|-----------|-------|-----|-----------|
| **CRIT** | formats | `src/formats/enfusion-text.ts:323-365,487-511` | **FMT-1** Parser can't handle inline multi-token vectors (`coords 0 0 0`). Adjacent bare tokens pair as bogus key/value props; Y/Z dropped; `serialize()` writes corrupted text. Real `.layer`/`.ent` + the project's own template (`scenario.ts:212`) use this grammar. **VERIFIED main-thread.** | Collect trailing bare tokens into `node.values`; add `coords 0 0 0`/`angles 0 90 0` round-trip test. | NEW |
| **HIGH** | pak (gap) | `src/pak/vfs.ts:168` | **PAK-1** Unbounded `inflateRawSync`; 500KB guard reads attacker-controlled `decompressedLen` header → zip-bomb OOM. `animation-graph.ts:508,1046` + `prefab-ancestry.ts:151` call with no precheck. | Pass `{maxOutputLength}`; move size check into `readFile()`. | NEW |
| **HIGH** | watcher (gap) | `src/watch/project-watcher.ts:106-120` | **WATCH-1** `handleUnlink` keys deletes off SOURCE root; rows stored per-project (`dirname(gproj)`). Subfolder addon → DELETE matches 0 rows; index leaks forever. | Resolve owning `.gproj` per unlink; apply to all 3 deletes. | NEW |
| **HIGH** | security | `src/tools/wb-validate.ts:60-74` | **SEC-NEW-01** Path traversal: `resolveResourcePath` joins without containment check; `..` escapes root → absolute escaped path to BI validator (CWE-22). Doesn't use `safe-path.ts`. | Reject `..`; `isContained()` per candidate incl. absolute branch. | New defect within known fix |
| **HIGH** | formats | `src/tools/world-diff.ts:72-83` | **FMT-2** `parsePosition` expects quoted form the parser never emits → move/position detection never fires on real files. | Fix after FMT-1; read from `node.values`. | NEW |
| **HIGH** | refactor | `src/tools/refactor-replace-guid.ts:134-143` | **RBE-1** `resolveAbsPath` returns FIRST project unconditionally; multi-project → wrong root (silent no-op, or corrupts unrelated file sharing the hex). | Use `resources.project_id` FK; resolve per owner. | Known |
| **HIGH** | refactor | `src/refactor/byte-edit.ts:471-473,647-662` | **RBE-2** Journal only in first target's dir; `recoverFromJournal` non-recursive → multi-dir commits unrecoverable after crash. | Journal to stable location; deterministic recovery scan. | NEW |
| **HIGH** | refactor | `src/refactor/byte-edit.ts:350-351,464-465` | **RBE-3** `.bak` clobbered unconditionally; 2nd refactor overwrites pristine original with edited content → safety net becomes corrupt. | Refuse or `.bak.<uuid>` if `.bak` exists. | NEW |
| **HIGH** | tools-live | `src/workbench/client.ts:326-332` | **tools-live-1** `diagnose()` matches wrong NET-API string → no-handlers Workbench misclassified `error` not `up_no_handlers`. Recovery path :133 matches correctly — drifted. | Match `"Undefined API func"`; shared const. | NEW |
| **HIGH** | tools-live | `src/tools/wb-script-editor.ts:103,115` | **tools-live-2** Reads keys handler never emits (`path`/`file` vs `currentFile`; `text` vs `lineText`) → getCurrentFile always empty. | Read real keys. | NEW |
| **HIGH** | tools-live | `src/tools/wb-entities.ts:452-459` | **tools-live-3** SYSTEMIC: wb_* never inspect in-payload `status:"error"` (wire="Ok") → failed mutations render success, error demoted to "Note", `isError` unset. Affects layers/resources/clipboard/component/execute_action/entity_modify. | Shared helper: `status==="error"`→`{isError:true}`. L7 terrain is the correct model. | NEW |
| **HIGH** | tools-live/emcp | `wb-layers.ts:16-28`; `EMCP_WB_Layers.c:110-261` | **tools-live-4** Only 4/11 schema actions resolve (worse than documented 7/11); 7 hit "Unknown action" but render "Layer Updated" (via tools-live-3); 2 handler branches unreachable; layer identity mismatch (path string vs `ToInt()`→layer 0). | Trim enum to working set or implement; reconcile identity. | Known |
| **HIGH** | emcp | `EMCP_WB_ModifyEntity.c:537,647` | **emcp-1** `addArrayItem`/`setObjectClass` call crash-prone APIs with NO precheck (only `removeArrayItem` guarded) → uncaught VM exception can wedge bridge (live toast TEST-RESULTS:114). | Mirror precheck; wrap mutating calls → structured error. | NEW |
| **HIGH** | emcp | `EMCP_WB_ModifyEntity.c:287-312` | **emcp-3** `setProperty`/`clearProperty` lack component-as-topLevel resolution → `SetVariableValue` false for ALL component props (live-confirmed). | Resolve like `addArrayItem` does (proven pattern). | Known (re-verified) |
| **HIGH** | changeset-1.7 | `src/scraper/writer.ts:76-83` | **cs17-1** `mergeByName` keys purely on `name`; same-name/different-class entries collapse last-writer-wins. Live: 12 dup groups collapsed 157→156, a source's class list discarded each. | Union `classes`/`children` on collision, or key by `name+source`. | NEW |
| **HIGH** | tests | `src/scraper/writer.ts:36-105` | **T1** The data-loss-prevention logic (`writeClassesPreserving`/`mergeByName`) ships with ZERO tests — pure functions, trivially testable. | `tests/scraper/writer.test.ts`: preserve/overwrite/merge-collision. | NEW |
| **HIGH** | tests | `tests/tools/wb-validate.test.ts:51-136` | **T2** Tests cover only the precheck; the response-side "Inconclusive" VM-exception defense (the actual false-positive fix) + flag-smuggle are untested. | Extract `formatValidationResult`; test empty→Inconclusive+isError, etc. | Known |

## 3. Medium (compact)

- **SEC-NEW-02** `mod.ts:536-553` build action pushes unvalidated `addonName`/`outputPath`/`gprojPath`/`filterPath` into spawn argv (CWE-88) — the one tool skipping the otherwise-consistent flag-smuggle discipline.
- **SEC-NEW-03** `logs-filter.ts:172-211` ReDoS guard catches one shape; compiled regex runs un-timed per line; disableable via undocumented env.
- **ARCH-2** `resolve-guid.ts:67-70` 5 tools grab raw db + run SQL directly; `resolve-guid` reimplements `ProjectIndex.resolveGuid`. Route through ProjectIndex.
- **RES-1..4** `src/resources/{class,group,pattern}-resource.ts` return not-found as a *successful* read with `{error}` body, no `isError`/throw — only MCP surface with no error channel. `throw McpError`.
- **RBE-5** `refactor-move-resource-path.ts:241-246` file rename is OUTSIDE the atomic boundary → crash after ref-edits but before rename → all consumers point at newPath, file at oldPath. Doc's rollback guarantee false.
- **RBE-7** `refactor-normalize-dependencies.ts:33` `DEPS_BLOCK_RE [^}]*` stops at first `}` → nested brace orphans tail text = corrupt .gproj.
- **RBE-8** `refactor-remove-unused.ts:172-194` `absPath = row.file_path` verbatim relative → useless or CWD-dependent deletion script (same root cause as RBE-1).
- **tools-live-5** `client.ts:133-144,403-437` `recoverMissingHandlers` no concurrency dedup → concurrent wb_* calls race on `rmSync` + 30s poll socket storm. Single-flight like `ensureRunning`.
- **tools-live-6** `wb-resources.ts:43-74` `browse` unimplemented but renders empty success; still advertised.
- **tools-live-7** `wb-entities.ts:6-34` `formatEntityDetails` reads keys handler never emits, discards built `properties[]`, layer key mismatch.
- **tools-live-9** `EMCP_WB_ModifyEntity.c:287-378` `propertyPath` has two incompatible meanings (dot-path vs component class name) within one tool.
- **emcp-6** `EMCP_WB_EditorControl.c:80-86` `saveAs` silently calls `Save()` (overwrites current), returns ok.
- **FS-2** `animation-graph.ts:838-843` `outputPath` optional, no default → writes into literal `undefined/` folder; reports `undefined/MyTruck.agr`.
- **FS-3** `animation-graph.ts:1099` validator rules V14/V17/V18 dead — sole caller never passes `options`.
- **cs17-2** `writer.ts:73-75` `mergeByName` keeps upstream-removed entries forever; promised `--clean` flag doesn't exist.
- **PAK-2** `reader.ts:162-189` fixed-width reads unbounded → raw `RangeError` on truncated chunk.
- **PAK-3** `reader.ts:121-159` comment claims iterative; `parseEntry` recurses :157 → stack overflow on deep malicious tree.
- **WATCH-3** `project-watcher.ts:112` `resource_refs` cleanup same mismatch → orphaned refs; **WATCH-2** test masks WATCH-1 by putting `.gproj` at source root.
- **dd-01** `README.md:81,98` stale "8,693 indexed classes" (actual 8,821). **dd-02** `quickstart.md:21` "~487 tests/2 skipped" (actual 977/1).
- **T3** `search-engine.test.ts:351-361` relaxed assertion over-corrected to near-tautological. **T4** material-find-unused-textures cursor/lint logic untested.

## 4. Low / Hygiene

SEC-NEW-04 (`server-redact.ts:95-231` non-canonical fields pass through verbatim) · IDX-2 (schema-v3 comments for nonexistent migration) · RBE-9 (`recoverFromJournal` never called from startup — dead crash-recovery) · tools-live-8 (`terrain-inspect.ts:106` reads `error`, handler emits `message`) · tools-live-10 (mode-gate refusals omit `isError`) · emcp-7 (`EMCP_WB_Terrain.c:106` unescaped `world_path` in hand-built JSON → invalid on Windows backslash) · emcp-8 (move/rotate fetch unused `IEntity`; rotate ignores `SetVariableValue` return) · emcp-9 (Localization delete/modify report ok unverified) · FS-1 (`script-format.ts` false `trailingNewlineAdjusted` → spurious `.bak`) · FS-5 (`script-lint.ts` `if_paren` flags inside strings) · FS-6 (`animation/parser.ts:443` ASI zip names↔paths positionally, no alignment check) · cs17-4 (`detectBuildBranch` only matches `stable_`, no dev/exp) · cs17-6 (`wb-validate.ts:187` `as boolean` cast → `'false'` truthy) · PAK-4/5 · dd-03 (`scrape-meta.json` bakes machine-specific abs path) · dd-04 (`building-setup.ts:128` hardcoded parent GUID unverified vs 1.7) · dd-05 (OFFICIAL_SCENARIOS stamp pre-1.7) · dd-06 (hierarchy.json 871→8860 undocumented) · T5/T6/RES-5 · Dead code: `src/runtime/job.ts` JobStore (250 LOC) never constructed.

## 5. Cross-Cutting Themes

1. **The TS↔handler contract is unverified and drifting.** Highest-frequency root cause: TS reads response keys the `.c` handler never emits (tools-live-1/2/7/8), Zod enum exposes actions the handler doesn't implement (tools-live-4/6, emcp-2/4), in-payload `status:"error"` ignored wholesale (tools-live-3). **No integration assertion pins the TS tool to the handler's RegV'd keys/actions.**
2. **`project_id` is the schema-v2 FK the refactor tools forget to use.** RBE-1 + RBE-8 + WATCH-1/3 are the same per-project-vs-source-root path-key mismatch — the most repeated silent-data-loss vector.
3. **Errors reported as successes across surfaces.** wb_* demote failures to "Notes"; mode-gate refusals omit `isError`; all 3 resource handlers fake success on not-found; several emcp handlers report `ok` on unverified void calls.
4. **Enfusion grammar modeled inconsistently.** FMT-1 + FMT-2 + RBE-7 all stem from ad-hoc regex/token handling instead of one shared round-trip-tested parser.
5. **Untrusted binary parsed without bounds.** PAK-1..5 trust attacker-controlled headers throughout — the subsystem no dimension was scoped to read.
6. **Test confidence highest where coverage thinnest.** The writer (T1), VM-exception defense (T2), watcher real-layout (WATCH-2 actively masks the bug), resource handlers (RES-5) all untested.

## 6. Checked and Found SOUND

Hardened spawn surface (`shell:false`, argv arrays, flag-smuggle guards) · secret redaction of canonical BI secrets (type-enforced, no-spread) · `writeClassesPreserving` correctly preserved 812 enfusion classes when the zip vanished · **wb_validate KNOWN-HIGH genuinely + completely fixed** (precheck + response parser; 12 tests) — SEC-NEW-01 traversal is the one remaining gap within it · NetApiHandler dispatch (20 handlers, no VM exceptions on normal paths) · L7 terrain tools (correct status-check model) · Enforce tokenizer/parser robustness (no hangs on malformed input) · project-index v2 migration (no data loss) · re-scrape count brittleness NOT present (lower-bound assertions) · MCP prompt surface (SDK zod-validated) · arma-classes.json structurally sound (8009, no dupes).

## 7. Top 5 Actions (in order)

1. **Fix FMT-1 → FMT-2 with a round-trip test.** Only CRITICAL; silently corrupts entity transforms on parse→serialize (write tools: scenario_clone_area/apply_template) and disables world_diff. **Ship-blocker.**
2. **Cap `inflateRawSync` + bounds-check pak reader (PAK-1→2/3/4).** Move the guard into `readFile()` so no-precheck callers inherit it.
3. **Fix the per-project path class together: WATCH-1/3 + RBE-1 + RBE-8** (one root cause). Add WATCH-2 nested-addon regression test as proof.
4. **Add the systemic tools-live status helper (tools-live-3), wire it across wb_*,** fix the specific drift (1/2/4) + one handler-payload fixture test. Addresses Themes 1+3.
5. **Write T1 (scraper writer) + T2 (wb_validate response) tests; fix RBE-3 (`.bak` clobber) + SEC-NEW-01 (traversal).**

## 8. Refuted (10 — rigor signal)

listIndexedProjectFiles GROUP BY collapse · bare value-list mis-pairing · atomicCommit EXDEV mid-batch · replaceGuid rewrites inside SQF strings · checkGitState porcelain renamed-path mangle · extractBlocks drops GUID-named ASI groups · **rotate angleX/Y/Z write bug (contradicted by live evidence)** · wb_validate Inconclusive branch unreachable · search-engine relaxation masks indexer bug · no vitest pool isolation.

Plus: emcp-10 (`ListEntities.ToLower()`) pre-emptively recorded as a verified non-finding.
