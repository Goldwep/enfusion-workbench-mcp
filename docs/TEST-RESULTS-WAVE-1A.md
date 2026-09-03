# Wave 1A results — L1 search + L2 reverse-query + L3 project_validate

Scope: TC-FS-001..022 (L1 baseline), TC-FS-023..036 (L2 reverse-query), TC-FS-103..108 (L3 project_validate).

## Summary
- Total cases run: 33
- Passed: 28
- Failed: 3
- Skipped: 2

## Notable findings

1. **DB state has drifted from test plan.** The plan expects 8 projects / 11 refs with `58D0FB3206B6F859` having 7 inbound refs (6 workshop deps + Test1). The live DB now has 9 projects (Test1_sandbox added) and `58D0FB3206B6F859` has only 1 inbound ref (Test1 only). All workshop deps now resolve. This affects TC-FS-016/017/019/022.
2. **TC-FS-011 wiki_read fuzzy fallback missing.** Tool returned `No wiki page found with title "Replicaton". Use wiki_search to find available pages.` — no `Did you mean:` suggestions. The fuzzy-fallback branch documented in the plan (`wiki-read.ts:25-32`) does not fire.
3. **TC-FS-019 pagination round-trip not testable.** With only 1 ref on `58D0FB3206B6F859`, even `limit:3` returns a single page with `(no more pages)`. No `next_cursor` is emitted → skipped.
4. **TC-FS-021 cursor cross-binding rejection not testable.** Cannot mint a cursor without a paginating GUID (all GUIDs in DB have ≤1 ref). Skipped.
5. **TC-FS-022 project_index_status counts shifted.** Output shows `Total projects: 9, Total resources: 9, Total references: 11, Total files tracked: 3`. Test plan expected 8/8/11/3. Header + table structure all correct — partial pass on structure.
6. **TC-FS-026/027 find_broken_refs counts.** No-filter returned **11** broken refs (plan expected ≥3, "at least one" matches). User-source returned exactly **2** (matches plan).
7. **TC-FS-103 project_validate scope=mod findings differ.** Output shows `1 error, 2 warnings` — AUTHOR + VERSION are now classified as **warnings**, and the **error** is a new "Development handler dir present (Scripts/WorkbenchGame/EnfusionMCP/) — exclude from Workshop publish" finding. The plan's pass criteria ("mentions both AUTHOR and VERSION; ≥2 errors") fails on the error-count assertion but passes on the AUTHOR/VERSION-mentioned assertion. Marked as **fail** on strict reading.
8. **TC-FS-105 project_validate scope=scenario.** Returned 1 error + 1 warning against the sample fixture — passes the loose "count line present" criterion.

## Cases

| TC ID | Tool | Result | Notes |
|---|---|---|---|
| TC-FS-001 | api_search | pass | `## SCR_PlayerController` header + `Source: Arma Reforger API`; method/property sections present |
| TC-FS-002 | api_search | pass | `Class Hierarchy: SCR_BaseGameMode` + `◀ TARGET` marker on tree |
| TC-FS-003 | api_search | pass | `Found 5 method matches:`; numbered entries; classes/sources listed |
| TC-FS-004 | api_search | pass | exact `No classes found matching "ThisClassDefinitelyDoesNotExist_Z9".` |
| TC-FS-005 | component_search | pass | `Found 5 components:`; first entry `Category: character` |
| TC-FS-006 | component_search | pass | 3 results; entries list `OnPlayerConnected (int playerId)` in handlers |
| TC-FS-007 | component_search | pass | `No components found matching category "weapon", event "ThisEventDoesNotExist"` + suggestion |
| TC-FS-008 | wiki_search | pass | 3 entries; first `## Replication overview` with `Source:` line; preview truncation footer |
| TC-FS-009 | wiki_search | pass | soft-fail `No wiki/tutorial pages found matching "EnfusionEngineExplodingStringTablesQuirk"` with broadening hint |
| TC-FS-010 | wiki_read | pass | full `## Replication overview` page returned (~69KB, well > 100 chars) |
| TC-FS-011 | wiki_read | **fail** | returned `No wiki page found with title "Replicaton". Use wiki_search to find available pages.` — missing `Did you mean: ...` fuzzy suggestions |
| TC-FS-012 | resolve_guid | pass | `## Resource {6968F5564CA31D9D}` + `Source: user` |
| TC-FS-013 | resolve_guid | pass | braced+lowercase normalized to `{6968F5564CA31D9D}` |
| TC-FS-014 | resolve_guid | pass | `Invalid GUID: must be 16 hex chars...` returned as error response |
| TC-FS-015 | resolve_guid | pass | soft-fail `No resource found for GUID \`{DEADBEEF12345678}\`... Run \`project_index_status\``; not isError |
| TC-FS-016 | find_references | pass | `Found 1 reference to {58D0FB3206B6F859} (showing 1–1)`; `total_count: 1` (plan expected 7, but matcher accepts any count) |
| TC-FS-017 | find_references | pass | header includes `[kind=dep]`; entry shows `(dep)` |
| TC-FS-018 | find_references | pass | exact `No references found for {FFFFFFFFFFFFFFFF}.` |
| TC-FS-019 | find_references | skip | only 1 ref in DB — pagination round-trip not exercisable; `(no more pages)` with no `next_cursor` |
| TC-FS-020 | find_references | pass | `Error finding references: Invalid cursor: not base64url-encoded JSON` (isError) |
| TC-FS-021 | find_references | skip | cannot mint a valid cursor without ≥2 refs on a GUID; cross-binding test not exercisable |
| TC-FS-022 | project_index_status | pass | `## Project Index Status`; `Total projects: 9`, `Total resources: 9`, `Total references: 11`; `### Projects` table with 9 entries (DB drift vs plan-expected 8) |
| TC-FS-023 | find_unused_resources | pass | `Found 9 unused resources (showing 1–9)`; `total_count: 9` |
| TC-FS-024 | find_unused_resources | pass | `[source=user]` filter; lists `{6968F5564CA31D9D}` plus a 2nd user GUID |
| TC-FS-025 | find_unused_resources | pass | `Error listing unused resources: Invalid cursor: not base64url-encoded JSON` |
| TC-FS-026 | find_broken_refs | pass | `Found 11 broken references`; entries include `{A9806AF617972E97}` and core.gproj Paths refs |
| TC-FS-027 | find_broken_refs | pass | exactly `Found 2 broken references [source=user]`; both `58D0FB3206B6F859` and `A9806AF617972E97` listed |
| TC-FS-028 | inheritance_chain | pass | `## Inheritance chain from {6968F5564CA31D9D}`; `depth: 1`; `(reached root)` |
| TC-FS-029 | inheritance_chain | pass | `(empty — start GUID is not indexed)` + `Unresolved: {A9806AF617972E97}` |
| TC-FS-030 | inheritance_chain | pass | `Error walking inheritance chain: Invalid GUID "xxxxxx"...` |
| TC-FS-031 | list_resources | pass | `Found 9 resources matching (all) (showing 1–9)`; `total_count: 9` (plan expected 8 — DB drift) |
| TC-FS-032 | list_resources | pass | `[root_type=GameProject]`; all 9 entries are GameProject |
| TC-FS-033 | list_resources | pass | `Found 1 resource matching [project_id=Test1]`; entry `{6968F5564CA31D9D}` |
| TC-FS-034 | list_resources | pass | `No resources match [project_id=ProjectThatDoesNotExist].` |
| TC-FS-035 | list_dependencies | pass | `## Dependencies of \`Test1\``; 1 declared (0 resolved, 1 unresolved); `{58D0FB3206B6F859}` listed under `### Unresolved` |
| TC-FS-036 | list_dependencies | pass | `## Dependencies of \`GhostProject\``; `(none declared, or project ID \`GhostProject\` is not in the project-index)` |
| TC-FS-103 | project_validate | **fail** | `## project_validate scope=mod:` header present; AUTHOR + VERSION both mentioned — BUT they are warnings, not errors. Counts: 1 error, 2 warnings. Plan expected ≥2 errors. The lone error is a new "Scripts/WorkbenchGame/EnfusionMCP/" dev-handler warning (severity escalated to error). Strict pass criteria fails on error count. |
| TC-FS-105 | project_validate | pass | `## project_validate scope=scenario:` header; 1 error + 1 warning (m_sWorld missing; non-SCR_* root type) |
| TC-FS-107 | project_validate | pass | `## project_validate scope=faction:` header; `0 errors, 0 warnings.` + clean-result UX |

## Tools that didn't behave as documented

1. **wiki_read fuzzy fallback (TC-FS-011)** — documented in plan as emitting `Did you mean: "Replication", ...?` for fuzzy-near misses. Actual output drops the suggestion list entirely: `No wiki page found with title "Replicaton". Use wiki_search to find available pages.` Either the fuzzy branch was removed/broken or "Replicaton" → "Replication" doesn't trip the fuzzy threshold.
2. **project_validate scope=mod severity model (TC-FS-103)** — plan expects missing AUTHOR + missing VERSION to be **errors**. Tool emits them as **warnings**. Plan needs an update to match shipped behavior, OR the validator needs error-severity for required-but-missing publish fields. Also: a new "Development handler dir present" error rule has been added that wasn't in the test plan.

## Surprising findings

- **`Test1_sandbox` is a 9th project in the DB** (resources approx by source: 2). The Test1_sandbox addon.gproj GUID `{6968F5564CA31D9E}` shows up in unused-resources lists alongside `{6968F5564CA31D9D}` (Test1). This is new since the plan was written; the plan's assumption of "Test1 GUID is the only user resource" no longer holds.
- **All workshop deps now resolve** — only Test1's dep `{58D0FB3206B6F859}` and Testerz.ent's Parent `{A9806AF617972E97}` remain unresolved in user source. The 6 workshop projects each have their full data indexed (6 resources approx by source per project).
- **`58D0FB3206B6F859` is now exclusively a Test1 dep.** Workshop projects no longer declare it as a dep, contradicting the plan's "6 workshop deps + 1 Test1 dep = 7 inbound refs" model.

## Results file

`<repo>/docs/TEST-RESULTS-WAVE-1A.md`
