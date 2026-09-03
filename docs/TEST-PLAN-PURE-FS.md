# TEST-PLAN-PURE-FS — verifiable test cases for the pure-FS read-only MCP tools

Scope: the read-only cluster that never writes files and never needs a running Workbench. Targets are real files on disk (verified to exist before listing) and real GUIDs from the project-index DB at `C:\Users\<you>\.enfusion-mcp\project-index.db`.

**Workspace conventions used throughout this plan:**

- `<TEST1>` = `C:\Users\<you>\Documents\My Games\ArmaReforgerWorkbench\addons\Test1`
- `<CORE>` = `C:\Program Files (x86)\Steam\steamapps\common\Arma Reforger Tools\Workbench\addons\core`
- `<WORKSHOP>` = `C:\Users\<you>\Documents\My Games\ArmaReforger\addons`
- `<GAME_LOGS>` = `C:\Users\<you>\Documents\My Games\ArmaReforger\logs`
- `<WB_LOGS>` = `C:\Users\<you>\Documents\My Games\ArmaReforgerWorkbench\logs`
- `<DB>` = `C:\Users\<you>\.enfusion-mcp\project-index.db`
- `<REPO>` = repo root containing `tests/fixtures/sample-project/`

**Time-budget legend:** fast = <1s; medium = 1–5s; slow = 5–30s.

**Verified real GUIDs available in the index** (sourced via `node scripts/inspect-db.cjs`):

| GUID | Resource | Source |
|---|---|---|
| `6968F5564CA31D9D` | Test1 `addon.gproj` | user |
| `5614BBCCBB55ED1C` | core `core.gproj` | core |
| `659D56452C626640` | workshop mod A `addon.gproj` | workshop |
| `591AF5BDA9F7CE8B` | workshop mod B `addon.gproj` | workshop |
| `62EB4D903D542287` | workshop mod C `addon.gproj` | workshop |
| `6896852984E00689` | workshop mod D `addon.gproj` | workshop |
| `686769C81E781261` | workshop mod E `addon.gproj` | workshop |
| `66DA27889CA78B4E` | workshop mod F `addon.gproj` | workshop |
| `A9806AF617972E97` | (unindexed — referenced by Testerz.ent as Parent — **broken-ref target**) | n/a |
| `58D0FB3206B6F859` | (unindexed — declared as dep by 6 workshop projects + Test1 — **broken-ref target**) | n/a |
| `639064AD5A5F600B`, `53AB5D17A4D25BC6`, `5E2E8AAB6EE599B2`, `CB2D92434525FFFD` | (unindexed — Paths refs in core.gproj — **broken-ref targets**) | n/a |

**Verified real .c file targets** under `<TEST1>/Scripts/WorkbenchGame/EnfusionMCP/`:
22 .c files. No `modded class` declarations, no `[RPC]` attributes. Plain `class X : NetApiHandler / JsonApiStruct` only — this means script_overrides + script_find_rpc_handlers on Test1 return *empty* (a documented empty-UX path).

---

## L1 baseline search / read

### TC-FS-001: api_search — class lookup, single match, default verbosity
- **Input:** `{ "query": "SCR_PlayerController", "type": "class", "limit": 1 }`
- **Expected output shape:** markdown starting `## SCR_PlayerController`, contains `Source: Arma Reforger API` (or `Enfusion Engine API`), an `Inherits from:` line if parents exist, possibly `### Public Methods (N)`, `### Properties (N)`, an `Inherited Members` section. Single-match path takes the `verbose=true` branch (`formatClassResult(cls, true, …)` per `api-search.ts:428`).
- **Pass criteria:** stdout regex match `/^## SCR_PlayerController/m` AND `/Source: (Arma Reforger|Enfusion Engine) API/`. If no class with that exact name, fall back to "no classes" soft-fail message.
- **Test target:** `SCR_PlayerController` (a canonical Arma Reforger class — verified present by virtue of being referenced by every scenario template in `src/prompts/mission-setup.ts`).
- **Verifies:** class-search single-match formatter + inheritance chain join.
- **Time budget:** fast

### TC-FS-002: api_search — tree format with explicit `type: "class"`
- **Input:** `{ "query": "SCR_BaseGameMode", "type": "class", "format": "tree", "limit": 1 }`
- **Expected output shape:** markdown starting `Class Hierarchy: SCR_BaseGameMode`, ASCII tree with `└──` / `├──` characters, marker `◀ TARGET` on the matched class, footer `Source: …`. Per `api-search.ts:301-347`.
- **Pass criteria:** output contains both `Class Hierarchy:` and `◀ TARGET`.
- **Test target:** `SCR_BaseGameMode` (canonical, multi-child class).
- **Verifies:** `format=tree` rendering path.
- **Time budget:** fast

### TC-FS-003: api_search — method search with limit cap
- **Input:** `{ "query": "OnPlayerSpawned", "type": "method", "limit": 5 }`
- **Expected output shape:** header `Found N method matches:` followed by numbered entries `1. ClassName.signature` and `Class: ClassName (source)`. Per `formatMethodResult`.
- **Pass criteria:** first line matches `/^Found \d+ method/`. If zero, output starts `No methods found matching`.
- **Test target:** `OnPlayerSpawned` (a canonical event handler — likely present in API index).
- **Verifies:** method-search branch.
- **Time budget:** fast

### TC-FS-004: api_search — soft-fail on unknown query
- **Input:** `{ "query": "ThisClassDefinitelyDoesNotExist_Z9", "type": "class" }`
- **Expected output shape:** plain text `No classes found matching "ThisClassDefinitelyDoesNotExist_Z9".`
- **Pass criteria:** exact substring match `No classes found matching`. No `isError` flag.
- **Test target:** invented identifier guaranteed absent.
- **Verifies:** empty-result soft-fail UX.
- **Time budget:** fast

### TC-FS-005: component_search — category filter
- **Input:** `{ "category": "character", "limit": 5 }`
- **Expected output shape:** header `Found N components:`, each entry `## Name` with `Category: character[, …]` and an `### Event Handlers (N)` section when handlers exist. Per `component-search.ts`.
- **Pass criteria:** `/^Found \d+ component/` AND first entry contains `Category: character`.
- **Test target:** the `character` category is always populated (canonical components like `SCR_CharacterControllerComponent`).
- **Verifies:** category filter branch.
- **Time budget:** fast

### TC-FS-006: component_search — event filter
- **Input:** `{ "event": "OnPlayerConnected", "limit": 3 }`
- **Expected output shape:** at least one result whose `### Event Handlers` block lists `OnPlayerConnected(...)`. Soft-fail message starting `No components found` if none.
- **Pass criteria:** either contains `OnPlayerConnected` in the event-handlers list, or matches the documented empty-UX message.
- **Test target:** `OnPlayerConnected` (canonical multiplayer event).
- **Verifies:** event-name filter pruning.
- **Time budget:** fast

### TC-FS-007: component_search — empty filter combination
- **Input:** `{ "category": "weapon", "event": "ThisEventDoesNotExist", "source": "enfusion" }`
- **Expected output shape:** `No components found matching category "weapon", event "ThisEventDoesNotExist". Try broadening your search …` per `component-search.ts:160`.
- **Pass criteria:** exact substring match `No components found matching category "weapon"`.
- **Test target:** intentional empty intersection.
- **Verifies:** empty-UX with multi-filter description.
- **Time budget:** fast

### TC-FS-008: wiki_search — common topic
- **Input:** `{ "query": "replication", "limit": 3 }`
- **Expected output shape:** up to 3 entries, each `## Title` then `Source: …` and a 2000-char preview, separated by `\n\n---\n\n`. Per `wiki-search.ts`.
- **Pass criteria:** contains at least one `## ` heading; first entry has `Source: ` line.
- **Test target:** the wiki index ships with replication content per upstream BIKI scrape.
- **Verifies:** preview-truncated multi-result rendering.
- **Time budget:** fast

### TC-FS-009: wiki_search — single-result expansion
- **Input:** `{ "query": "EnfusionEngineExplodingStringTablesQuirk", "limit": 1 }`
- **Expected output shape:** either single-result with up to 8000 chars (MAX_LENGTH bumps for single result per `wiki-search.ts:48`), OR `No wiki/tutorial pages found …` soft-fail.
- **Pass criteria:** if matches, contains `## `; if not, contains `No wiki/tutorial pages found matching`.
- **Test target:** fabricated query expected to miss → exercises the empty branch.
- **Verifies:** soft-fail branch + suggestion phrasing.
- **Time budget:** fast

### TC-FS-010: wiki_read — exact title hit
- **Input:** `{ "title": "<title returned by TC-FS-008>" }`
- **Expected output shape:** `## <title>\nSource: …\n\n<full content up to 100,000 chars>` with optional truncation footer.
- **Pass criteria:** content length > 100 chars; starts with `## `.
- **Test target:** chain off TC-FS-008's first result title.
- **Verifies:** full-page read path.
- **Time budget:** fast

### TC-FS-011: wiki_read — fuzzy fallback
- **Input:** `{ "title": "Replicaton" }` (intentional typo)
- **Expected output shape:** `No wiki page found with title "Replicaton". Did you mean: "Replication", ...?` per `wiki-read.ts:25-32`.
- **Pass criteria:** matches `/No wiki page found with title "Replicaton". Did you mean:/`.
- **Test target:** misspelled common term — should fuzzy-match real pages.
- **Verifies:** fuzzy-fallback suggestion branch.
- **Time budget:** fast

### TC-FS-012: resolve_guid — known GUID
- **Input:** `{ "guid": "6968F5564CA31D9D" }`
- **Expected output shape:** `## Resource {6968F5564CA31D9D}` then bulleted `**File:** addon.gproj`, `**Root type:** GameProject`, `**Source:** user`. Per `formatResolvedGuid`.
- **Pass criteria:** matches `/^## Resource \{6968F5564CA31D9D\}/m` AND contains `Source: user`.
- **Test target:** Test1's addon.gproj GUID (verified present in DB).
- **Verifies:** successful lookup.
- **Time budget:** fast

### TC-FS-013: resolve_guid — braced form & case-insensitive
- **Input:** `{ "guid": "{6968f5564ca31d9d}" }`
- **Expected output shape:** identical to TC-FS-012 (normalizer strips braces + uppercases per `normalizeGuid`).
- **Pass criteria:** contains `{6968F5564CA31D9D}` (uppercase form).
- **Test target:** Test1 GUID in lower+braced form.
- **Verifies:** GUID normalization.
- **Time budget:** fast

### TC-FS-014: resolve_guid — invalid GUID format
- **Input:** `{ "guid": "not-a-guid" }`
- **Expected output shape:** `Invalid GUID: must be 16 hex chars, optionally wrapped in braces. Got: not-a-guid`. `isError: true`.
- **Pass criteria:** exact substring `Invalid GUID:` AND `isError: true` in response.
- **Test target:** literal invalid string.
- **Verifies:** GUID regex validation.
- **Time budget:** fast

### TC-FS-015: resolve_guid — unknown GUID (soft-fail)
- **Input:** `{ "guid": "DEADBEEF12345678" }`
- **Expected output shape:** `No resource found for GUID \`{DEADBEEF12345678}\` in the project-index. The resource may live in a project not yet indexed, or may not exist in this Reforger install. Run \`project_index_status\` to see what's indexed.` per `formatNotFound`. No isError.
- **Pass criteria:** contains `No resource found for GUID` AND `Run \`project_index_status\``. NO isError.
- **Test target:** unindexed GUID DEADBEEF12345678.
- **Verifies:** soft-fail vs. hard error distinction.
- **Time budget:** fast

### TC-FS-016: find_references — known target with refs
- **Input:** `{ "guid": "58D0FB3206B6F859", "limit": 20 }`
- **Expected output shape:** `Found 7 references to {58D0FB3206B6F859} (showing 1–7):` (or similar — 7 refs counted in current DB: 6 workshop deps + 1 Test1 dep). Numbered list. `total_count: 7`, `(no more pages)`. Per `formatPage`.
- **Pass criteria:** matches `/^Found \d+ references to \{58D0FB3206B6F859\}/m` AND contains `total_count: \d+`.
- **Test target:** common dep GUID referenced from 7 indexed projects.
- **Verifies:** paginated query with total > 0.
- **Time budget:** fast

### TC-FS-017: find_references — kind filter
- **Input:** `{ "guid": "58D0FB3206B6F859", "kind": "dep", "limit": 20 }`
- **Expected output shape:** `Found N references to {58D0FB3206B6F859} [kind=dep] (showing 1–N):`. Every entry's parenthetical contains `(dep)`.
- **Pass criteria:** matches `/Found \d+ references? to \{58D0FB3206B6F859\} \[kind=dep\]/`. Every numbered line ends in `(dep) — …` or `(dep)`.
- **Test target:** same GUID; all 7 refs are dep-kind.
- **Verifies:** kind-filter branch.
- **Time budget:** fast

### TC-FS-018: find_references — zero hits (soft-fail)
- **Input:** `{ "guid": "FFFFFFFFFFFFFFFF" }`
- **Expected output shape:** `No references found for {FFFFFFFFFFFFFFFF}. Either the resource is unused, or the project containing references isn't indexed yet.`
- **Pass criteria:** matches `/^No references found for \{FFFFFFFFFFFFFFFF\}/m`.
- **Test target:** GUID guaranteed absent.
- **Verifies:** empty-result soft-fail.
- **Time budget:** fast

### TC-FS-019: find_references — pagination round-trip
- **Input pass 1:** `{ "guid": "58D0FB3206B6F859", "limit": 3 }`. Capture the returned `next_cursor`.
- **Input pass 2:** `{ "guid": "58D0FB3206B6F859", "limit": 3, "cursor": "<next_cursor>" }`
- **Expected output shape:** pass 1 shows entries 1–3 with `next_cursor: ...`; pass 2 shows entries 4–6 OR final page with `(no more pages)`.
- **Pass criteria:** pass 1 contains `next_cursor:` line; pass 2's "showing X–Y" range is strictly after pass 1's.
- **Test target:** same GUID with 7 refs; force pagination via low limit.
- **Verifies:** cursor encoding/decoding + offset advancement.
- **Time budget:** fast

### TC-FS-020: find_references — invalid cursor rejected
- **Input:** `{ "guid": "6968F5564CA31D9D", "cursor": "bogus" }`
- **Expected output shape:** `Error finding references: Invalid cursor: not base64url-encoded JSON`. `isError: true`.
- **Pass criteria:** isError true AND text contains `Invalid cursor`.
- **Test target:** Test1's GUID + a malformed cursor.
- **Verifies:** cursor-decode error path.
- **Time budget:** fast

### TC-FS-021: find_references — cursor bound to GUID
- **Input:** Use a cursor generated for GUID A, replay it with GUID B.
- **Expected output shape:** `Error finding references: Invalid cursor: cursor does not match the current query (cursors are bound to a specific GUID)`.
- **Pass criteria:** text contains `cursor does not match the current query`.
- **Test target:** Pass 1: `find_references` on `5614BBCCBB55ED1C` to mint a cursor; Pass 2: replay on `6968F5564CA31D9D`.
- **Verifies:** cursor cross-binding rejection.
- **Time budget:** fast

### TC-FS-022: project_index_status — no args
- **Input:** `{}`
- **Expected output shape:** `## Project Index Status` then `- **Total projects:** 8`, `- **Total resources:** 8`, `- **Total references:** 11`, `- **Total files tracked:** 3`, `- **DB:** <path> (KB)`. `### Projects` table with 8 numbered entries. Per `formatStatus`.
- **Pass criteria:** matches `/^## Project Index Status/m` AND contains `Total projects:`, `Total resources:`, `### Projects`.
- **Test target:** current DB has 8 projects / 8 resources / 11 refs.
- **Verifies:** empty-input, formatted snapshot.
- **Time budget:** fast

---

## L2 reverse-query

### TC-FS-023: find_unused_resources — no filter
- **Input:** `{ "limit": 50 }`
- **Expected output shape:** `Found N unused resources (showing 1–M):` numbered entries `1. file_path — root_type [class] {GUID} (source=...)`, then `total_count: N`, and either `next_cursor:` or `(no more pages)`. Per `formatUnusedPage`.
- **Pass criteria:** matches `/^Found \d+ unused resource/m` OR `/^No unused resources found/`. Current DB has 8 resources, 11 refs — likely 1+ unused (Test1's addon.gproj GUID likely has no inbound ref).
- **Test target:** all indexed sources.
- **Verifies:** unfiltered listing.
- **Time budget:** fast

### TC-FS-024: find_unused_resources — user source only
- **Input:** `{ "source": "user", "limit": 50 }`
- **Expected output shape:** results restricted to `source=user`; header `Found N unused resources [source=user] …`. Test1 addon.gproj (`6968F5564CA31D9D`) has zero inbound refs → expect it listed.
- **Pass criteria:** matches `/\[source=user\]/`; result list shows `6968F5564CA31D9D` somewhere.
- **Test target:** user source.
- **Verifies:** source filter.
- **Time budget:** fast

### TC-FS-025: find_unused_resources — invalid cursor
- **Input:** `{ "source": "user", "cursor": "not-base64" }`
- **Expected output shape:** `Error listing unused resources: Invalid cursor: not base64url-encoded JSON`. `isError: true`.
- **Pass criteria:** isError true; text contains `Invalid cursor`.
- **Test target:** malformed cursor.
- **Verifies:** cursor decode safety.
- **Time budget:** fast

### TC-FS-026: find_broken_refs — no filter
- **Input:** `{ "limit": 50 }`
- **Expected output shape:** `Found N broken references (showing 1–M):` entries `1. source_file → {target_guid} (ref_kind) — context`. The current DB has multiple broken refs (e.g., `639064AD5A5F600B`, `53AB5D17A4D25BC6` from core.gproj Paths; `A9806AF617972E97` from Testerz.ent Parent; `58D0FB3206B6F859` dep refs). Expect N≥3.
- **Pass criteria:** matches `/^Found \d+ broken references?/m` AND `total_count: \d+` AND at least one entry references `639064AD5A5F600B` OR `A9806AF617972E97`.
- **Test target:** all sources.
- **Verifies:** broken-ref detection.
- **Time budget:** fast

### TC-FS-027: find_broken_refs — source=user (subset)
- **Input:** `{ "source": "user", "limit": 50 }`
- **Expected output shape:** restricted to refs originating from user-source files. Test1 has 2 broken refs in current DB (addon.gproj dep `58D0FB3206B6F859`; Testerz.ent Parent `A9806AF617972E97`). Expected count: 2.
- **Pass criteria:** matches `/^Found 2 broken references \[source=user\]/` (exact count 2 expected).
- **Test target:** user source.
- **Verifies:** source filter on broken-refs.
- **Time budget:** fast

### TC-FS-028: inheritance_chain — empty-chain start (unindexed parent inheritance)
- **Input:** `{ "guid": "6968F5564CA31D9D" }`
- **Expected output shape:** `## Inheritance chain from {6968F5564CA31D9D}`. Since Test1 GUID is a GameProject (no parent_inherit per DB), expect single-step or empty chain. Per `formatChain`.
- **Pass criteria:** matches `/^## Inheritance chain from \{6968F5564CA31D9D\}/m`; output ends with either `(reached root)` or `depth: 1`.
- **Test target:** Test1 GUID — known to have no parent_inherit.
- **Verifies:** single-step chain rendering.
- **Time budget:** fast

### TC-FS-029: inheritance_chain — unresolved parent
- **Input:** `{ "guid": "A9806AF617972E97" }`
- **Expected output shape:** start GUID is not indexed (it's the unresolved Parent of Testerz.ent). Expect `(empty — start GUID is not indexed)`. Per `formatChain:37-42`.
- **Pass criteria:** contains `(empty — start GUID is not indexed)`.
- **Test target:** known-unindexed GUID.
- **Verifies:** empty-chain UX.
- **Time budget:** fast

### TC-FS-030: inheritance_chain — invalid GUID
- **Input:** `{ "guid": "xxxxxx" }`
- **Expected output shape:** `Error walking inheritance chain: Invalid GUID "xxxxxx": expected 16 hex characters, with or without braces`. `isError: true`.
- **Pass criteria:** isError true; text contains `Invalid GUID`.
- **Test target:** literal invalid.
- **Verifies:** GUID validation in inheritance walker.
- **Time budget:** fast

### TC-FS-031: list_resources — no filter
- **Input:** `{ "limit": 50 }`
- **Expected output shape:** `Found 8 resources matching (all) (showing 1–8):` numbered list of all 8 indexed resources; `total_count: 8`; `(no more pages)`. Per `formatListPage`.
- **Pass criteria:** matches `/^Found 8 resources matching \(all\)/m` AND `total_count: 8`.
- **Test target:** current DB (8 resources).
- **Verifies:** unfiltered list.
- **Time budget:** fast

### TC-FS-032: list_resources — root_type filter
- **Input:** `{ "root_type": "GameProject", "limit": 50 }`
- **Expected output shape:** `Found 8 resources matching [root_type=GameProject] (showing 1–8):`. Every entry's middle field is `— GameProject`.
- **Pass criteria:** matches `/\[root_type=GameProject\]/` AND no entries with different root types.
- **Test target:** all 8 current resources are GameProjects.
- **Verifies:** root_type filter branch.
- **Time budget:** fast

### TC-FS-033: list_resources — project_id filter
- **Input:** `{ "project_id": "Test1" }`
- **Expected output shape:** `Found 1 resource matching [project_id=Test1] (showing 1–1):` exactly one entry — Test1's addon.gproj.
- **Pass criteria:** matches `/^Found 1 resource matching \[project_id=Test1\]/m` AND one entry containing `{6968F5564CA31D9D}`.
- **Test target:** Test1 project.
- **Verifies:** project_id filter.
- **Time budget:** fast

### TC-FS-034: list_resources — no match
- **Input:** `{ "project_id": "ProjectThatDoesNotExist" }`
- **Expected output shape:** `No resources match [project_id=ProjectThatDoesNotExist].`
- **Pass criteria:** exact `No resources match`.
- **Test target:** fabricated id.
- **Verifies:** empty-UX.
- **Time budget:** fast

### TC-FS-035: list_dependencies — known indexed project
- **Input:** `{ "project_id": "Test1" }`
- **Expected output shape:** `## Dependencies of \`Test1\`` then `Total deps declared: 1 (0 resolved, 1 unresolved)` then `### Unresolved` listing `{58D0FB3206B6F859}`. Test1 has 1 dep, unresolved.
- **Pass criteria:** matches `/^## Dependencies of `Test1`/m` AND contains `{58D0FB3206B6F859}` AND `### Unresolved`.
- **Test target:** Test1 (1 unresolved dep).
- **Verifies:** unresolved-dep rendering.
- **Time budget:** fast

### TC-FS-036: list_dependencies — project not in index
- **Input:** `{ "project_id": "GhostProject" }`
- **Expected output shape:** `## Dependencies of \`GhostProject\`\n\n(none declared, or project ID \`GhostProject\` is not in the project-index)`.
- **Pass criteria:** contains `(none declared, or project ID \`GhostProject\` is not in the project-index)`.
- **Test target:** missing id.
- **Verifies:** soft-fail formatter.
- **Time budget:** fast

---

## L3 logs cluster

### TC-FS-037: logs_list — workbench default
- **Input:** `{}`
- **Expected output shape:** `## workbench log sessions (N total, showing newest M)` then `Root: <WB_LOGS>` then numbered entries `  1. logs_YYYY-MM-DD_HH-MM-SS — channel1/channel2/... — SIZE` with optional `  CRASH` marker. Newest first.
- **Pass criteria:** matches `/^## workbench log sessions \(\d+ total/m`; at least 1 numbered entry; root path matches `WB_LOGS`.
- **Test target:** `<WB_LOGS>` (verified ≥10 sessions including 2026-05-22_05-27-54).
- **Verifies:** session list newest-first.
- **Time budget:** fast

### TC-FS-038: logs_list — game logs
- **Input:** `{ "which": "game" }`
- **Expected output shape:** `## game log sessions (N total …)`; root path matches `<GAME_LOGS>`. 7 sessions including one with `CRASH` (logs_2026-05-20_07-13-23 has crash.log).
- **Pass criteria:** matches `/^## game log sessions/m`; some entry contains `CRASH`.
- **Test target:** `<GAME_LOGS>`.
- **Verifies:** `which=game` switch.
- **Time budget:** fast

### TC-FS-039: logs_tail — latest workbench console default
- **Input:** `{}`
- **Expected output shape:** `## logs_YYYY-MM-DD_HH-MM-SS / console.log — last N of M lines\n\n```\n<line content>\n````. Per `formatTail`.
- **Pass criteria:** matches `/^## logs_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2} \/ console.log — last \d+ of \d+ lines/m`; contains a fenced code block.
- **Test target:** latest WB session.
- **Verifies:** default-args tail.
- **Time budget:** fast

### TC-FS-040: logs_tail — explicit session + crash channel
- **Input:** `{ "which": "game", "session": "logs_2026-05-20_07-13-23", "channel": "crash", "lines": 30 }`
- **Expected output shape:** `## logs_2026-05-20_07-13-23 / crash.log — last 30 of M lines` with fenced block. Crash file is ~11KB so M > 30 expected.
- **Pass criteria:** matches `/last 30 of \d+ lines/`; output contains a code fence.
- **Test target:** the verified-present crash session.
- **Verifies:** absolute session + non-console channel.
- **Time budget:** fast

### TC-FS-041: logs_tail — missing session
- **Input:** `{ "session": "logs_9999-12-31_00-00-00" }`
- **Expected output shape:** `Session 'logs_9999-12-31_00-00-00' not found. Try \`logs_list\`.`
- **Pass criteria:** matches `/Session 'logs_9999-12-31_00-00-00' not found/`.
- **Test target:** fabricated future session.
- **Verifies:** missing-session UX.
- **Time budget:** fast

### TC-FS-042: logs_filter — level=error
- **Input:** `{ "which": "game", "session": "logs_2026-05-20_07-13-23", "channel": "error", "level": "error", "limit": 50 }`
- **Expected output shape:** `## logs_… / error.log — N matches (level=error) (showing 1–M)` then fenced block with line-number-prefixed entries, then `total_count: N`.
- **Pass criteria:** matches `/^## logs_\d.* \/ error.log — \d+ matches/m`; `total_count: \d+`.
- **Test target:** known non-empty error.log (~223KB).
- **Verifies:** level filter.
- **Time budget:** medium (223KB scan)

### TC-FS-043: logs_filter — pattern regex
- **Input:** `{ "which": "game", "session": "logs_2026-05-20_07-13-23", "pattern": "obsolete|deprecated", "limit": 20 }`
- **Expected output shape:** as above, `filterDescription` includes `pattern=…`; or `No matches in …` if regex matches nothing.
- **Pass criteria:** either `No matches in` OR `matches` with regex-derived count line.
- **Test target:** common deprecation marker.
- **Verifies:** regex-pattern path.
- **Time budget:** medium

### TC-FS-044: logs_filter — ReDoS guard
- **Input:** `{ "pattern": "(a+)+b" }`
- **Expected output shape:** `Pattern rejected: nested quantifier detected (e.g. (X+)+) — risks catastrophic backtracking on log lines. Rewrite without nested \`+\`/\`*\` on capture groups, or set ENFUSION_DISABLE_PATTERN_GUARD=1.`. `isError: true`.
- **Pass criteria:** isError true; text contains `Pattern rejected: nested quantifier`.
- **Test target:** classic catastrophic-backtrack regex.
- **Verifies:** SEC-L3-001 ReDoS guard (`logs-filter.ts:175-188`).
- **Time budget:** fast

### TC-FS-045: logs_filter — pattern too long
- **Input:** `{ "pattern": "<201-char string>" }`
- **Expected output shape:** `Pattern too long (201 chars, max 200). Pre-filter your match more aggressively.`. `isError: true`.
- **Pass criteria:** isError true; text contains `Pattern too long`.
- **Test target:** synth 201-char pattern.
- **Verifies:** pattern-length guard.
- **Time budget:** fast

### TC-FS-046: logs_summarize_errors — game session with errors
- **Input:** `{ "which": "game", "session": "logs_2026-05-20_07-13-23", "channel": "error", "top_n": 15 }`
- **Expected output shape:** `## logs_… / error.log error summary` then `Scanned N lines: M errors, K warnings, G unique groups.` then `Showing top X groups:` and numbered entries `1. (E) [CATEGORY] ×N — first @ line L`. Per `formatSummary`.
- **Pass criteria:** matches `/^## logs_\d.* \/ error.log error summary/m`; matches `/Scanned \d+ lines: \d+ errors, \d+ warnings/`.
- **Test target:** known non-empty error.log.
- **Verifies:** signature aggregation.
- **Time budget:** medium

### TC-FS-047: logs_summarize_errors — clean session UX
- **Input:** `{ "which": "workbench", "session": "logs_2026-05-22_05-27-54", "channel": "error" }`
- **Expected output shape:** if the error.log has zero warn/error entries, output ends with `(no warnings or errors — clean session)`. Per `formatSummary:96`.
- **Pass criteria:** if zero, contains `(no warnings or errors — clean session)`; else contains a numbered group list.
- **Test target:** latest WB session.
- **Verifies:** clean-session empty-UX branch.
- **Time budget:** fast

---

## L3 world / scenario inspection

### TC-FS-048: world_compose_summary — minimal Testerz.ent (SubScene stub)
- **Input:** `{ "world_path": "<TEST1>/worlds/MP/Testerz.ent" }`
- **Expected output shape:** `# World summary: <abs>`, `- **Total entities:** 1`, `- **Distinct classes:** 1`, `- **SubScene parent refs:** 1`, `- **Sibling layer files:** 1`, optional bounding info. Section `## SubScene parent references` with `\`{A9806AF617972E97}worlds/Arland/Arland.ent\``.
- **Pass criteria:** matches `/^# World summary:/m`; contains `Total entities:`, `SubScene parent refs: 1`, the literal GUID `A9806AF617972E97`.
- **Test target:** the actual minimal `Testerz.ent` (verified 65 bytes — SubScene Parent only).
- **Verifies:** SubScene parent extraction + sibling-layer discovery.
- **Time budget:** fast

### TC-FS-049: world_compose_summary — file not found
- **Input:** `{ "world_path": "C:/no/such/world.ent" }`
- **Expected output shape:** `Error analyzing world: file not found at C:\\no\\such\\world.ent`. `isError: true`.
- **Pass criteria:** isError true; text contains `file not found`.
- **Test target:** invented path.
- **Verifies:** existsSync failure path.
- **Time budget:** fast

### TC-FS-050: world_validate_refs — Testerz.ent
- **Input:** `{ "file_path": "<TEST1>/worlds/MP/Testerz.ent" }`
- **Expected output shape:** `## Refs in <abs>`, then `Total refs found: 1 (0 resolved, 1 unresolved)`, then `### Unresolved (1)` containing `- {A9806AF617972E97} — at inheritance "{A9806AF617972E97}worlds/Arland/Arland.ent" (inside SubScene)` (or asset_path kind depending on extraction — actually it's a `Parent` property so it'll be `asset_path`). Per `formatReport`.
- **Pass criteria:** matches `/^## Refs in/m`; contains `{A9806AF617972E97}`; contains `### Unresolved (1)`.
- **Test target:** Testerz.ent.
- **Verifies:** single-file ref-walk + unresolved bucket.
- **Time budget:** fast

### TC-FS-051: world_diff — same file diffed against itself
- **Input:** `{ "before_path": "<TEST1>/worlds/MP/Testerz.ent", "after_path": "<TEST1>/worlds/MP/Testerz.ent" }`
- **Expected output shape:** all four buckets (added/removed/moved/modified) empty → ends with `No semantic differences detected.`
- **Pass criteria:** contains `No semantic differences detected.`
- **Test target:** same file twice.
- **Verifies:** zero-diff UX.
- **Time budget:** fast

### TC-FS-052: world_diff — file not found
- **Input:** `{ "before_path": "<TEST1>/worlds/MP/Testerz.ent", "after_path": "C:/missing.ent" }`
- **Expected output shape:** `after_path not found: C:\\missing.ent`. `isError: true`.
- **Pass criteria:** isError true; text contains `after_path not found`.
- **Test target:** real before, missing after.
- **Verifies:** per-arg existence check.
- **Time budget:** fast

### TC-FS-053: scenario_inspect — sample fixture
- **Input:** `{ "scenario_path": "<REPO>/tests/fixtures/sample-project/configs/test.conf" }`
- **Expected output shape:** `## Scenario: test.conf` with `- **Game mode**:`, `- **Linked world**:`, `- **Factions** (N):`, `- **Bases/spawns**:`, `- **Objectives**:`, `- **Layer files**: 0`. Per `formatScenarioSummary`.
- **Pass criteria:** matches `/^## Scenario: test.conf/m`; contains all six bullet labels.
- **Test target:** repo's bundled sample-project fixture (verified present).
- **Verifies:** scenario shape extraction.
- **Time budget:** fast
- **NOTE — KNOWN GAP:** the task brief mentioned `mode=balance` (L8 fold-in). The shipped `scenario_inspect` tool (per `src/tools/scenario-inspect.ts`) does NOT expose a `mode` parameter — only `scenario_path`. Adding `mode=balance` is an unshipped extension; flagged in §Tool Gaps below.

### TC-FS-054: scenario_inspect — missing file
- **Input:** `{ "scenario_path": "C:/no/such.conf" }`
- **Expected output shape:** `Scenario file not found: C:\\no\\such.conf`. `isError: true`.
- **Pass criteria:** isError; contains `Scenario file not found`.
- **Test target:** invented.
- **Verifies:** missing-file handling.
- **Time budget:** fast

### TC-FS-055: scenario_diff — same fixture against itself
- **Input:** `{ "before_path": "<REPO>/tests/fixtures/sample-project/configs/test.conf", "after_path": "<REPO>/tests/fixtures/sample-project/configs/test.conf" }`
- **Expected output shape:** structural diff with all empty deltas; ends in `No semantic differences detected.` (or per `formatScenarioDiffSummary` style depending on the formatter — pinned in scenario-diff.ts).
- **Pass criteria:** contains either `No semantic differences detected.` OR an explicit "no changes" block with empty added/removed lists.
- **Test target:** sample fixture twice.
- **Verifies:** zero-diff UX.
- **Time budget:** fast

---

## L3 workshop pre-flight

### TC-FS-056: workshop_validate_manifest — Test1 .gproj (missing required fields)
- **Input:** `{ "gproj_path": "<TEST1>/addon.gproj" }`
- **Expected output shape:** validation findings — Test1's .gproj has TITLE/ID/GUID + Dependencies but **lacks AUTHOR and VERSION** (verified by reading the file). Expect ≥2 error-severity findings for missing AUTHOR + VERSION.
- **Pass criteria:** output mentions both `AUTHOR` and `VERSION` as missing/required; `severity: error` count ≥ 2.
- **Test target:** real Test1 addon.gproj (verified content: only ID/GUID/TITLE/Dependencies).
- **Verifies:** required-field gate.
- **Time budget:** fast

### TC-FS-057: workshop_validate_manifest — wrong extension
- **Input:** `{ "gproj_path": "<TEST1>/worlds/MP/Testerz.ent" }`
- **Expected output shape:** findings indicate file isn't a `.gproj` (the validator parses as Enfusion text; without standard GameProject fields it will flag every required field missing). Likely `severity: error` for missing ID/GUID/TITLE/etc.
- **Pass criteria:** ≥3 error findings.
- **Test target:** Testerz.ent (verified — non-gproj content).
- **Verifies:** non-gproj content path.
- **Time budget:** fast

### TC-FS-058: workshop_check_deps — Test1 (1 unresolved)
- **Input:** `{ "gproj_path": "<TEST1>/addon.gproj" }`
- **Expected output shape:** `## Dependencies of addon.gproj`, `1 declared, 0 resolved, 1 unresolved.`, then `### Unresolved` with `- {58D0FB3206B6F859}`. Per `formatDepStatus`.
- **Pass criteria:** matches `/^## Dependencies of addon.gproj/m` AND `1 declared, 0 resolved, 1 unresolved.` AND `{58D0FB3206B6F859}`.
- **Test target:** Test1 (verified single dep, unresolved).
- **Verifies:** file-scoped dep check (vs. index-scoped `list_dependencies`).
- **Time budget:** fast

### TC-FS-059: workshop_check_deps — missing .gproj
- **Input:** `{ "gproj_path": "C:/no/such.gproj" }`
- **Expected output shape:** `.gproj not found at: C:\\no\\such.gproj`. `isError: true`.
- **Pass criteria:** isError; contains `.gproj not found at`.
- **Test target:** invented path.
- **Verifies:** existence check.
- **Time budget:** fast

---

## L4 asset inspection

### TC-FS-060: material_inspect — no real .emat available
- **Input:** `{ "material_path": "<synthetic .emat fixture>" }`
- **Expected output shape:** parses synthetic content, emits `## Material: <basename>` with shader-class header, `### Texture refs`, `### Parameters`. Per `formatMaterialSummary`.
- **Pass criteria:** matches `/^## Material:/m`; texture/parameter sections present.
- **Test target:** **NO REAL .EMAT EXISTS ON DISK** — all workshop+core .emat files live inside paks. Proposed fixture path: `<REPO>/tests/fixtures/synthetic/sample.emat` (NEEDS CREATING; not part of this plan). Until then, this test case is a fixture-blocked entry. Fallback: tool exists path-not-found branch — pass `{ "material_path": "C:/missing.emat" }` and assert the missing-file UX.
- **Verifies:** end-to-end inspect path.
- **Time budget:** fast

### TC-FS-061: material_inspect — file not found (fallback path)
- **Input:** `{ "material_path": "C:/no/such.emat" }`
- **Expected output shape:** `Error inspecting material: …` with isError true.
- **Pass criteria:** isError; text starts with `Error inspecting material:`.
- **Test target:** invented.
- **Verifies:** missing-file error path.
- **Time budget:** fast

### TC-FS-062: material_find_unused_textures — Test1 (empty disk walk)
- **Input:** `{ "source": "user", "limit": 50 }`
- **Expected output shape:** Test1 has no `.edds` files on disk → either `No unused textures found` OR a paginated list whose `total_count` is 0.
- **Pass criteria:** matches `/total_count: 0/` OR matches an empty-UX message.
- **Test target:** user source against Test1.
- **Verifies:** zero-on-disk fast path.
- **Time budget:** fast

### TC-FS-063: material_diff — synthetic fixtures
- **Input:** `{ "before_path": "<fixture A>", "after_path": "<fixture B>" }`
- **Expected output shape:** structural diff with added/removed/changed textures + parameters. Both fixtures NEED CREATING.
- **Pass criteria:** fixture-blocked. Fallback test: pass `{ "before_path": "C:/missing1.emat", "after_path": "C:/missing2.emat" }` and assert the existence-check error.
- **Test target:** **NO REAL .EMAT AVAILABLE** — see TC-FS-060.
- **Verifies:** diff renderer.
- **Time budget:** fast

### TC-FS-064: ui_layout_inspect — no real .layout
- **Input:** `{ "layout_path": "<synthetic .layout fixture>" }`
- **Expected output shape:** ASCII widget tree with indentation. Per `ui-layout-inspect.ts`.
- **Pass criteria:** fixture-blocked. Fallback: `{ "layout_path": "C:/no/such.layout" }` → `Error inspecting layout: file not found at …`. Verified the error path with isError: true.
- **Test target:** **NO REAL .LAYOUT AVAILABLE** on disk (all in paks).
- **Verifies:** widget-tree formatter (when fixture exists).
- **Time budget:** fast

### TC-FS-065: ui_localization_audit — Test1 (no StringTables)
- **Input:** `{ "gproj_path": "<TEST1>/addon.gproj" }`
- **Expected output shape:** since Test1's gproj has no `StringTables {}` block, expect an empty audit — `tables: 0`. Renders as either a clean report or "(no StringTables declared)" message.
- **Pass criteria:** output indicates zero declared StringTables.
- **Test target:** real Test1 gproj.
- **Verifies:** no-tables UX.
- **Time budget:** fast

### TC-FS-066: ui_layout_validate — no real .layout
- **Input:** synthetic fixture
- **Expected output shape:** lint findings with `error/warning/info` buckets.
- **Pass criteria:** fixture-blocked. Fallback: `{ "layout_path": "C:/no/such.layout" }` → existence error.
- **Test target:** **NO REAL .LAYOUT AVAILABLE.**
- **Verifies:** lint dispatcher (when fixture exists).
- **Time budget:** fast

### TC-FS-067: ui_extract_strings — Test1 .c file
- **Input:** `{ "target_path": "<TEST1>/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Terrain.c" }`
- **Expected output shape:** scans for SetText / Set*-style call patterns. EMCP_WB_Terrain.c has no `SetText("…")` calls — expect 0 suggestions OR an empty-UX message.
- **Pass criteria:** zero suggestions reported.
- **Test target:** real .c file (verified).
- **Verifies:** .c branch with empty result.
- **Time budget:** fast

### TC-FS-068: ui_extract_strings — unsupported extension
- **Input:** `{ "target_path": "<TEST1>/addon.gproj" }`
- **Expected output shape:** `Error extracting strings: unsupported extension ".gproj" — expected .layout or .c`. `isError: true`.
- **Pass criteria:** isError; text contains `unsupported extension`.
- **Test target:** real .gproj path.
- **Verifies:** extension gate.
- **Time budget:** fast

### TC-FS-069: ui_styles_inspect — no real .styles
- **Input:** synthetic fixture
- **Expected output shape:** Markdown summary of style entries per `extractStyles`.
- **Pass criteria:** fixture-blocked. Fallback: `{ "styles_path": "C:/no/such.styles" }` → `Error inspecting styles: file not found at …`.
- **Test target:** **NO REAL .STYLES AVAILABLE**.
- **Verifies:** entry projection.
- **Time budget:** fast

### TC-FS-070: particle_inspect — no real .ptc
- **Input:** synthetic fixture
- **Expected output shape:** ParticleSummary with emitters/curves/gradients sections.
- **Pass criteria:** fixture-blocked. Fallback: `{ "particle_path": "C:/no/such.ptc" }` → `Error inspecting particle: cannot read file: …` (isError true).
- **Test target:** **NO REAL .PTC AVAILABLE.**
- **Verifies:** read-error branch.
- **Time budget:** fast

### TC-FS-071: asset_orphan_scan — Test1
- **Input:** `{ "source": "user", "limit": 50 }`
- **Expected output shape:** Test1 has no .edds/.acp/.fbx/.ogg/.wav files on disk → expect zero orphans (`total_count: 0` or empty-UX). Per `formatOrphanPage`.
- **Pass criteria:** `total_count: 0` or empty-UX message.
- **Test target:** user-source orphan scan against Test1.
- **Verifies:** empty disk-walk path.
- **Time budget:** medium (workshop+user disk walk)

---

## L6 script tools (mini-parser)

### TC-FS-072: script_analyze — EMCP_WB_Terrain.c
- **Input:** `{ "script_path": "<TEST1>/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Terrain.c" }`
- **Expected output shape:** `## script_analyze: EMCP_WB_Terrain.c`, then `Found 3 classes, …`. Per `formatScriptSummary`. File has `EMCP_WB_TerrainRequest`, `EMCP_WB_TerrainResponse`, `EMCP_WB_Terrain` classes.
- **Pass criteria:** matches `/^## script_analyze: EMCP_WB_Terrain.c/m`; matches `/Found 3 classes/`; class headers `### class EMCP_WB_TerrainRequest`, `### class EMCP_WB_TerrainResponse`, `### class EMCP_WB_Terrain` present.
- **Test target:** verified 160-line real .c file with 3 classes.
- **Verifies:** AST → markdown pipeline.
- **Time budget:** fast

### TC-FS-073: script_analyze — missing file
- **Input:** `{ "script_path": "C:/no/such.c" }`
- **Expected output shape:** `Script file not found: C:\\no\\such.c`. `isError: true`.
- **Pass criteria:** isError; text contains `Script file not found`.
- **Test target:** invented.
- **Verifies:** existence guard.
- **Time budget:** fast

### TC-FS-074: script_analyze — flag-shape guard
- **Input:** `{ "script_path": "-test.c" }`
- **Expected output shape:** `Invalid script_path: must not start with '-'`. `isError: true`.
- **Pass criteria:** isError; text contains `must not start with '-'`.
- **Test target:** path starting with hyphen.
- **Verifies:** flag-smuggle guard.
- **Time budget:** fast

### TC-FS-075: script_overrides — Test1 (empty result)
- **Input:** `{ "project_root": "<TEST1>" }`
- **Expected output shape:** `## modded class declarations in <abs>`, `Scanned 22 .c files. Found 0 modded chains.`, then `No modded classes found.` Per `formatOverrides`. Test1 has zero `modded class` declarations.
- **Pass criteria:** matches `/Scanned \d+ .c files. Found 0 modded chains/`; contains `No modded classes found.`
- **Test target:** Test1 (verified no modded classes in its 22 .c files).
- **Verifies:** empty-result UX.
- **Time budget:** fast

### TC-FS-076: script_overrides — class_name filter
- **Input:** `{ "project_root": "<TEST1>", "class_name": "SCR_PlayerController" }`
- **Expected output shape:** empty result with class-filter description: `## modded class declarations for class \`SCR_PlayerController\` in <abs>` then `Scanned 22 .c files. Found 0 modded chains.` then `No \`modded class SCR_PlayerController\` declarations found in this project.`
- **Pass criteria:** matches `/for class \`SCR_PlayerController\`/` AND `Found 0 modded chains`.
- **Test target:** Test1 + canonical class name.
- **Verifies:** filter-description branch.
- **Time budget:** fast

### TC-FS-077: script_lint — clean file
- **Input:** `{ "script_path": "<TEST1>/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Terrain.c" }`
- **Expected output shape:** `## script_lint: EMCP_WB_Terrain.c`, counts line `N errors, M warnings, K infos`, `Rules run: trailing_whitespace, indent_mixed, if_paren_spacing, missing_super_modded, rpc_missing_channel`. Findings present or `✅ Clean. No findings.` per `formatLintReport`.
- **Pass criteria:** matches `/^## script_lint: EMCP_WB_Terrain.c/m`; matches `/Rules run: trailing_whitespace/`.
- **Test target:** real .c file.
- **Verifies:** all 5 rules run.
- **Time budget:** fast

### TC-FS-078: script_lint — single rule
- **Input:** `{ "script_path": "<TEST1>/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Terrain.c", "rules": ["trailing_whitespace"] }`
- **Expected output shape:** `Rules run: trailing_whitespace`. Only this one rule's findings.
- **Pass criteria:** matches `/Rules run: trailing_whitespace$/m` (single-rule form).
- **Test target:** real .c.
- **Verifies:** rules-subset gating.
- **Time budget:** fast

### TC-FS-079: script_format — dry-run on clean file
- **Input:** `{ "script_path": "<TEST1>/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Terrain.c", "commit": false }`
- **Expected output shape:** either `## script_format: EMCP_WB_Terrain.c\n\n✅ Already clean — no formatting changes needed.` OR a per-bullet delta + dry-run footer `DRY-RUN. Pass \`commit: true\` to write the cleaned file.` Per `formatReport`.
- **Pass criteria:** matches `/^## script_format: EMCP_WB_Terrain.c/m`; either `Already clean` OR `DRY-RUN.`
- **Test target:** real .c (file already well-formed by deploy script).
- **Verifies:** dry-run reporter.
- **Time budget:** fast

### TC-FS-080: script_format — non-.c rejected
- **Input:** `{ "script_path": "<TEST1>/addon.gproj" }`
- **Expected output shape:** `script_format only handles .c files; got '<TEST1>/addon.gproj'.`. `isError: true`.
- **Pass criteria:** isError; text contains `only handles .c files`.
- **Test target:** real .gproj path.
- **Verifies:** extension guard (audit-fix L6 S5).
- **Time budget:** fast

### TC-FS-081: script_class_hierarchy — root class
- **Input:** `{ "project_root": "<TEST1>", "class_name": "EMCP_WB_TerrainRequest" }`
- **Expected output shape:** ASCII tree with `EMCP_WB_TerrainRequest` rooted (its base is `JsonApiStruct`, which isn't in Test1 — chain stops). Per `formatHierarchy`.
- **Pass criteria:** matches `/EMCP_WB_TerrainRequest/`; output structured as tree.
- **Test target:** real class in Test1.
- **Verifies:** hierarchy builder + tree renderer.
- **Time budget:** fast

### TC-FS-082: script_class_hierarchy — unknown class
- **Input:** `{ "project_root": "<TEST1>", "class_name": "DoesNotExist" }`
- **Expected output shape:** empty/sparse tree, no records found for the class.
- **Pass criteria:** does not crash; output contains the class name.
- **Test target:** absent class.
- **Verifies:** missing-class graceful handling.
- **Time budget:** fast

### TC-FS-083: script_extract_interface — all classes
- **Input:** `{ "script_path": "<TEST1>/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Terrain.c" }`
- **Expected output shape:** `## Public interface: EMCP_WB_Terrain.c` with 3 `### \`class …\`` sections (one per class). Per `formatInterface`.
- **Pass criteria:** matches `/^## Public interface: EMCP_WB_Terrain.c/m`; 3 `### \`class` headers.
- **Test target:** real .c.
- **Verifies:** public-surface filter.
- **Time budget:** fast

### TC-FS-084: script_extract_interface — class-filtered
- **Input:** `{ "script_path": "<TEST1>/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Terrain.c", "class_name": "EMCP_WB_TerrainResponse" }`
- **Expected output shape:** one `### \`class EMCP_WB_TerrainResponse\`` header only.
- **Pass criteria:** exactly one `### \`class` line; the class name matches.
- **Test target:** real class in real file.
- **Verifies:** class filter.
- **Time budget:** fast

### TC-FS-085: script_extract_interface — unknown class
- **Input:** `{ "script_path": "<TEST1>/Scripts/WorkbenchGame/EnfusionMCP/EMCP_WB_Terrain.c", "class_name": "Ghost" }`
- **Expected output shape:** `No class \`Ghost\` in this file.` per `formatInterface:40-41`.
- **Pass criteria:** matches `No class \`Ghost\` in this file.`
- **Test target:** real .c + fake class name.
- **Verifies:** empty-class-filter UX.
- **Time budget:** fast

### TC-FS-086: script_find_rpc_handlers — Test1 (empty)
- **Input:** `{ "project_root": "<TEST1>" }`
- **Expected output shape:** Test1's .c files have no `[RPC]` attributes → 0 hits. `Scanned 22 .c files. Found 0 ...` or similar.
- **Pass criteria:** output shows 0 hits.
- **Test target:** Test1 (verified no `[RPC]` markers in source).
- **Verifies:** empty-UX path.
- **Time budget:** fast

### TC-FS-087: script_find_rpc_handlers — attribute_name override
- **Input:** `{ "project_root": "<TEST1>", "attribute_name": "Attribute" }`
- **Expected output shape:** still 0 hits (Test1 has no `[Attribute]` decorators either).
- **Pass criteria:** 0 hits.
- **Test target:** Test1 with alternate attribute name.
- **Verifies:** attribute_name override branch.
- **Time budget:** fast

---

## L8 read-only

### TC-FS-088: gm_spawn_list_export — Test1, markdown (likely empty)
- **Input:** `{ "project_path": "<TEST1>", "format": "markdown" }`
- **Expected output shape:** Test1 has no `Configs/Editor/PlaceableEntities/` tree → expect empty catalog. The formatter produces a header + "no factions" message.
- **Pass criteria:** runs without error; output contains some "no factions" or empty-table message.
- **Test target:** Test1.
- **Verifies:** empty-walk path + markdown formatter.
- **Time budget:** fast

### TC-FS-089: gm_spawn_list_export — JSON format
- **Input:** `{ "project_path": "<TEST1>", "format": "json" }`
- **Expected output shape:** `## GM Spawn List: <TEST1>` then a fenced ```json block containing `{"factions":[]}` (or similar minimal shape).
- **Pass criteria:** contains \`\`\`json fence; JSON parses; has `factions` key.
- **Test target:** Test1.
- **Verifies:** json branch.
- **Time budget:** fast

### TC-FS-090: gm_spawn_list_export — missing project_path
- **Input:** `{ "project_path": "C:/missing", "format": "markdown" }`
- **Expected output shape:** `Project root does not exist: C:\\missing` (thrown via `resolveProjectRoot`). `isError: true`.
- **Pass criteria:** isError; text contains `Project root does not exist`.
- **Test target:** invented.
- **Verifies:** existence guard.
- **Time budget:** fast

### TC-FS-091: faction_list_units — Test1 (no faction-affiliation entities)
- **Input:** `{ "project_path": "<TEST1>" }`
- **Expected output shape:** `## Factions in <TEST1>`, scanned 0–N entity files, no faction units found. Per `formatFactionList:68-79`. Test1 only has `Testerz.ent` (one SubScene root, no FactionAffiliationComponent).
- **Pass criteria:** matches `/^## Factions in/m`; "no entities" message present.
- **Test target:** Test1.
- **Verifies:** empty-walk path.
- **Time budget:** fast

### TC-FS-092: faction_list_units — faction_key filter
- **Input:** `{ "project_path": "<TEST1>", "faction_key": "US" }`
- **Expected output shape:** filter description echoes `Filter: faction_key = \`US\`` then no-entities message scoped to US.
- **Pass criteria:** contains `Filter: faction_key = \`US\`` AND no-results phrasing.
- **Test target:** Test1 + filter.
- **Verifies:** filter branch.
- **Time budget:** fast

### TC-FS-093: animation_find_unused_clips — Test1 (no .anm files)
- **Input:** `{ "project_path": "<TEST1>" }`
- **Expected output shape:** Test1 has no `.anm` clips → expect empty result. Per `findUnusedClips`.
- **Pass criteria:** output indicates 0 clips scanned / 0 unused.
- **Test target:** Test1.
- **Verifies:** empty-disk-walk path.
- **Time budget:** fast

### TC-FS-094: animation_find_unused_clips — missing path
- **Input:** `{ "project_path": "C:/missing" }`
- **Expected output shape:** `Project path does not exist: C:\\missing`. `isError: true`.
- **Pass criteria:** isError; text contains `Project path does not exist`.
- **Test target:** invented.
- **Verifies:** path-existence check.
- **Time budget:** fast

### TC-FS-095: weapon_pose_lint — no real .agr
- **Input:** synthetic AGR
- **Expected output shape:** lint findings comparing GlobalTags against DEFAULT_EXPECTED_TAGS.
- **Pass criteria:** fixture-blocked. Fallback: `{ "agr_path": "C:/no/such.agr" }` → `AGR file not found: C:\\no\\such.agr` (isError: true).
- **Test target:** **NO REAL .AGR AVAILABLE** (workshop subs are pak'd; Test1 has none).
- **Verifies:** missing-file branch.
- **Time budget:** fast

### TC-FS-096: weapon_pose_lint — flag-shape guard
- **Input:** `{ "agr_path": "-test.agr" }`
- **Expected output shape:** thrown error `Invalid agr_path: must not start with '-'` (flag-smuggle guard).
- **Pass criteria:** isError; text contains `must not start with '-'`.
- **Test target:** hyphen-prefixed path.
- **Verifies:** flag-smuggle guard.
- **Time budget:** fast

### TC-FS-097: server_mod_list — synthetic server.json
- **Input:** `{ "server_config_path": "<REPO>/tests/fixtures/sample-server.json" }` (NEEDS CREATING). Use real GUIDs in mods array: `["6968F5564CA31D9D", "591AF5BDA9F7CE8B", "FFFFFFFFFFFFFFFF"]` (Test1 user, Capture&Hold workshop, unindexed).
- **Expected output shape:** markdown report; first two GUIDs resolved (with source label), third unknown. Per `buildModListReport`.
- **Pass criteria:** mentions both `6968F5564CA31D9D` (resolved) and `FFFFFFFFFFFFFFFF` (unknown).
- **Test target:** **synthetic file required** — `<REPO>/tests/fixtures/sample-server.json` containing `{ "game": { "mods": [ {"modId": "6968F5564CA31D9D", "name": "Test1"}, {"modId": "591AF5BDA9F7CE8B", "name": "Capture&Hold"}, {"modId": "FFFFFFFFFFFFFFFF", "name": "Ghost"} ] } }`.
- **Verifies:** GUID-resolution against project-index.
- **Time budget:** fast

### TC-FS-098: server_mod_list — missing file
- **Input:** `{ "server_config_path": "C:/no/such.json" }`
- **Expected output shape:** `Error listing server mods: …` (isError true).
- **Pass criteria:** isError; text starts with `Error listing server mods`.
- **Test target:** invented.
- **Verifies:** missing-file error path.
- **Time budget:** fast

### TC-FS-099: server_scenario_picker — without workshop
- **Input:** `{ "include_workshop": false }`
- **Expected output shape:** markdown table of curated official scenarios + any in Test1's Missions/. Test1 has no Missions/ → user-project section empty. Per `buildScenarioPickerReport`.
- **Pass criteria:** output is non-empty markdown; mentions vanilla scenarios.
- **Test target:** default config (Test1 as projectPath).
- **Verifies:** baseline picker.
- **Time budget:** fast

### TC-FS-100: server_scenario_picker — with workshop
- **Input:** `{ "include_workshop": true }`
- **Expected output shape:** as above, plus any `SCR_MissionHeader*` .conf files found under workshop. May be slow with 67 workshop addons but all are pak'd so disk-walk finds zero .conf.
- **Pass criteria:** runs to completion; output is non-empty.
- **Test target:** workshop included.
- **Verifies:** workshop-scan branch.
- **Time budget:** medium (walks 67 subscription dirs)

### TC-FS-101: server_health_probe — unreachable host (negative test)
- **Input:** `{ "host": "127.0.0.1", "query_port": 17777, "timeout_ms": 200 }`
- **Expected output shape:** `Error probing server: …` with a network-error message. `isError: true`.
- **Pass criteria:** isError true; text starts with `Error probing server:`.
- **Test target:** loopback with no server listening (typical CI/dev state). 200ms timeout keeps this fast.
- **Verifies:** UDP-timeout error path.
- **Time budget:** fast

### TC-FS-102: server_health_probe — timeout cap
- **Input:** `{ "host": "127.0.0.1", "timeout_ms": 999999 }`
- **Expected output shape:** zod validation error — rejected at schema (exceeds MAX_TIMEOUT_MS). Or coerced to max.
- **Pass criteria:** either zod rejection or response within MAX_TIMEOUT_MS.
- **Test target:** out-of-range timeout.
- **Verifies:** schema bound enforcement.
- **Time budget:** fast

### TC-FS-103: project_validate scope=mod — Test1
- **Input:** `{ "scope": "mod", "target": "<TEST1>/addon.gproj" }`
- **Expected output shape:** `## project_validate scope=mod: <abs>`, count line `2 errors, 0 warnings` (or similar — TEST1 lacks AUTHOR + VERSION), `### Errors` listing AUTHOR + VERSION as required-but-missing. Per `formatProjectValidate`.
- **Pass criteria:** matches `/^## project_validate scope=mod:/m`; ≥2 errors; mentions both AUTHOR and VERSION.
- **Test target:** real Test1 addon.gproj.
- **Verifies:** mod-scope dispatcher → `validateManifest`.
- **Time budget:** fast

### TC-FS-104: project_validate scope=mod — wrong extension
- **Input:** `{ "scope": "mod", "target": "<TEST1>/worlds/MP/Testerz.ent" }`
- **Expected output shape:** error finding `scope=mod expects a .gproj file path`. Per `validateMod`.
- **Pass criteria:** output contains `scope=mod expects a .gproj file path`.
- **Test target:** real .ent path.
- **Verifies:** extension gate.
- **Time budget:** fast

### TC-FS-105: project_validate scope=scenario — sample fixture
- **Input:** `{ "scope": "scenario", "target": "<REPO>/tests/fixtures/sample-project/configs/test.conf" }`
- **Expected output shape:** zero or more findings against the .conf. Per `validateScenario`.
- **Pass criteria:** matches `/^## project_validate scope=scenario:/m`; count line present.
- **Test target:** sample fixture (verified present).
- **Verifies:** scenario dispatcher.
- **Time budget:** fast

### TC-FS-106: project_validate scope=scenario — wrong extension
- **Input:** `{ "scope": "scenario", "target": "<TEST1>/addon.gproj" }`
- **Expected output shape:** error `scope=scenario expects a .conf file path`.
- **Pass criteria:** contains `scope=scenario expects a .conf file path`.
- **Test target:** .gproj.
- **Verifies:** extension gate.
- **Time budget:** fast

### TC-FS-107: project_validate scope=faction — Test1 root
- **Input:** `{ "scope": "faction", "target": "<TEST1>" }`
- **Expected output shape:** `## project_validate scope=faction: <abs>`. Test1 has no `Configs/Factions/` tree — expect 0 findings or "no faction configs" info per F5 rule.
- **Pass criteria:** matches `/^## project_validate scope=faction:/m`; zero error findings or info-level "no factions" message.
- **Test target:** Test1.
- **Verifies:** faction dispatcher → `validateFaction`.
- **Time budget:** fast

### TC-FS-108: project_validate — unknown scope
- **Input:** `{ "scope": "garbage", "target": "<TEST1>/addon.gproj" }`
- **Expected output shape:** zod rejects at schema (scope is `z.enum(["mod","scenario","faction"])`). Validation error surfaced by the SDK.
- **Pass criteria:** response indicates schema validation failure (either MCP error or isError true).
- **Test target:** invalid enum value.
- **Verifies:** scope enum bound.
- **Time budget:** fast

---

## Prompts

Prompts are tested by **invoking the prompt** and asserting the returned message structure. They do not execute tools — they return a `{ messages: [{ role: "user", content: { type: "text", text: ... } }] }` envelope.

### TC-FS-109: prompt mission_setup — conflict template
- **Input:** `{ "mission_name": "Operation Northstar", "template": "conflict", "factions": ["US","FIA"] }`
- **Expected output shape:** one user-role message; text starts with `I want to scaffold a new mission`; contains `Display name: Operation Northstar`, `Scenario id (filename): Operation_Northstar`, `Template: conflict`, `Factions: \`US\`, \`FIA\``. Six `## Step` sections.
- **Pass criteria:** matches `/^I want to scaffold a new mission/m`; contains `Operation_Northstar`; six `## Step` headers.
- **Test target:** prompt invocation.
- **Verifies:** template branch + scenario-id derivation.
- **Time budget:** fast

### TC-FS-110: prompt mission_setup — defaults
- **Input:** `{ "mission_name": "Test Mission" }`
- **Expected output shape:** template defaults to `conflict`; factions default to `["US","FIA"]`.
- **Pass criteria:** contains `Template: conflict` AND `Factions: \`US\`, \`FIA\``.
- **Test target:** prompt with minimum args.
- **Verifies:** default-value path.
- **Time budget:** fast

### TC-FS-111: prompt mission_setup — game_master template
- **Input:** `{ "mission_name": "GM Sandbox", "template": "game_master" }`
- **Expected output shape:** template-specific Step 2 body — uses `config_create` with missionMode "Conflict" and references `wb_knowledge`.
- **Pass criteria:** contains `configType: "mission-header"` AND `missionMode: "Conflict"` AND `wb_knowledge`.
- **Test target:** game_master branch.
- **Verifies:** `renderGameMasterStep`.
- **Time budget:** fast

### TC-FS-112: prompt character_anim_pipeline_guide — defaults
- **Input:** `{}`
- **Expected output shape:** text starts `Walk me through Enfusion's character animation pipeline for a **soldier**. Target reading level: **beginner**.` Per `renderGuide` default args.
- **Pass criteria:** matches `/^Walk me through Enfusion's character animation pipeline for a \*\*soldier\*\*/m`; contains `**beginner**`.
- **Test target:** prompt with no args.
- **Verifies:** default-arg branch.
- **Time budget:** fast

### TC-FS-113: prompt character_anim_pipeline_guide — expert level
- **Input:** `{ "target_character": "pilot", "audience_level": "expert" }`
- **Expected output shape:** opens with `pilot` and `expert`; includes expert-specific sections (proc-anim layering, m_BoneRemap, RNG-based clip selection per `renderGuide` expert branch).
- **Pass criteria:** contains both `pilot` and `expert`; matches additional expert section keywords.
- **Test target:** override args.
- **Verifies:** level-conditional rendering.
- **Time budget:** fast

### TC-FS-114: prompt create-mod
- **Input:** `{ "description": "A zombie survival mode with AI waves" }`
- **Expected output shape:** one user message starting `I want to create an Arma Reforger mod: A zombie survival mode with AI waves`; contains `STEP 0: ASSESS COMPLEXITY` etc.
- **Pass criteria:** matches `/^I want to create an Arma Reforger mod: A zombie survival mode with AI waves/m`; contains `STEP 0:`.
- **Test target:** prompt invocation.
- **Verifies:** prompt body emission.
- **Time budget:** fast

### TC-FS-115: prompt modify-mod
- **Input:** `{ "projectPath": "<TEST1>", "task": "Add a stamina system" }`
- **Expected output shape:** text containing both `<TEST1>` and `Add a stamina system`, plus references to `project_browse`, `project_read`, `MODPLAN.md`.
- **Pass criteria:** contains both inputs verbatim and `MODPLAN.md`.
- **Test target:** prompt with real project path.
- **Verifies:** template substitution.
- **Time budget:** fast

---

## Summary

### Counts
- **Total test cases designed:** 115
- **L1 baseline:** TC-FS-001..022 (22 cases)
- **L2 reverse-query:** TC-FS-023..036 (14 cases)
- **L3 logs:** TC-FS-037..047 (11 cases)
- **L3 world/scenario:** TC-FS-048..055 (8 cases)
- **L3 workshop pre-flight:** TC-FS-056..059 (4 cases)
- **L4 asset inspection:** TC-FS-060..071 (12 cases)
- **L6 script tools:** TC-FS-072..087 (16 cases)
- **L8 read-only:** TC-FS-088..108 (21 cases)
- **Prompts:** TC-FS-109..115 (7 cases)

### Time-budget distribution
- **fast (<1s):** ~106 cases
- **medium (1–5s):** 7 cases (TC-FS-042, TC-FS-043, TC-FS-046, TC-FS-062, TC-FS-071, TC-FS-100, plus one or two pagination follow-ups under ~5s)
- **slow (5–30s):** 0 cases (the heaviest is workshop scenario-picker scan; observed sub-5s on similar walks)

### Test targets verified to exist (one per tool)

| Tool | Target | Verified |
|---|---|---|
| api_search | `SCR_PlayerController` (canonical) | by reference in shipped prompts |
| component_search | `character` category | canonical category enum |
| wiki_search | `replication` (canonical) | wiki index ships scraped content |
| wiki_read | (chained off wiki_search) | dynamic |
| resolve_guid / find_references | `6968F5564CA31D9D` (Test1 .gproj) | DB query confirmed |
| inheritance_chain | `6968F5564CA31D9D`; unresolved `A9806AF617972E97` | DB query confirmed |
| project_index_status | (no args) | DB has 8 projects |
| find_unused_resources | source=user → Test1 GUID expected unused | DB inspection |
| find_broken_refs | source=user → 2 broken refs | DB inspection counts 11 total, 2 user-sourced |
| list_resources | project_id=Test1 | DB confirmed |
| list_dependencies | project_id=Test1 (1 unresolved dep) | DB confirmed |
| logs_list | `<WB_LOGS>` (10+ sessions) + `<GAME_LOGS>` (7 sessions, 1 with CRASH) | `ls` confirmed |
| logs_tail | `logs_2026-05-20_07-13-23/crash.log` (11KB) | `ls` confirmed |
| logs_filter | game session error.log (223KB) | `ls` confirmed |
| logs_summarize_errors | game session error.log | `ls` confirmed |
| world_compose_summary | `<TEST1>/worlds/MP/Testerz.ent` (65 bytes, SubScene stub) | Read confirmed |
| world_validate_refs | same | Read confirmed |
| world_diff | same vs itself | derived |
| scenario_inspect | `<REPO>/tests/fixtures/sample-project/configs/test.conf` | tests/fixtures confirmed |
| scenario_diff | same vs itself | derived |
| workshop_validate_manifest | `<TEST1>/addon.gproj` (missing AUTHOR + VERSION) | Read confirmed |
| workshop_check_deps | `<TEST1>/addon.gproj` (1 unresolved dep) | Read confirmed |
| material_inspect / material_find_unused_textures / material_diff | (**NO real .emat available** — see Gaps) | — |
| ui_layout_inspect / ui_layout_validate | (**NO real .layout available** — see Gaps) | — |
| ui_localization_audit | `<TEST1>/addon.gproj` (no StringTables) | Read confirmed |
| ui_extract_strings | `<TEST1>/Scripts/.../EMCP_WB_Terrain.c` | Read confirmed |
| ui_styles_inspect | (**NO real .styles available** — see Gaps) | — |
| particle_inspect | (**NO real .ptc available** — see Gaps) | — |
| asset_orphan_scan | user source against Test1 (no .edds on disk → empty walk) | walked confirmed |
| script_analyze / lint / format / extract_interface | `<TEST1>/Scripts/.../EMCP_WB_Terrain.c` (160 lines, 3 classes) | Read confirmed |
| script_overrides / script_class_hierarchy | `<TEST1>` project root (22 .c files, 0 modded — empty UX) | Grep confirmed |
| script_find_rpc_handlers | `<TEST1>` (no [RPC] markers — empty UX) | Grep confirmed |
| gm_spawn_list_export / faction_list_units | `<TEST1>` (empty PlaceableEntities tree) | walked |
| animation_find_unused_clips | `<TEST1>` (no .anm) | walked |
| weapon_pose_lint | (**NO real .agr available** — see Gaps) | — |
| server_mod_list | synthetic `<REPO>/tests/fixtures/sample-server.json` (NEEDS CREATING) | — |
| server_scenario_picker | default config (Test1 as projectPath) | OK |
| server_health_probe | `127.0.0.1:17777` loopback (negative test — no server) | derived |
| project_validate scope=mod | `<TEST1>/addon.gproj` | confirmed |
| project_validate scope=scenario | `<REPO>/tests/fixtures/sample-project/configs/test.conf` | confirmed |
| project_validate scope=faction | `<TEST1>` (no factions tree) | confirmed |

### Tools where NO real test target exists on disk (fixture gap)

These all need synthetic fixtures created (or fallback to negative-path tests only):

1. **material_inspect / material_diff** — all real `.emat` files live inside paks (`<CORE>/data.pak`, every workshop's `data.pak`). Test1 has none. **Proposed fallback:** create `<REPO>/tests/fixtures/synthetic/sample.emat` + a sibling `sample_after.emat` with one diffed texture. Until then: only the "file not found" branches are testable end-to-end.
2. **ui_layout_inspect / ui_layout_validate** — same paks problem. **Proposed fallback:** synthetic `<REPO>/tests/fixtures/synthetic/sample.layout`.
3. **ui_styles_inspect** — same. **Proposed fallback:** `<REPO>/tests/fixtures/synthetic/sample.styles`.
4. **particle_inspect** — same. Additionally, per the tool's source comment, the .ptc text-format shape is **UNVERIFIED**. **Proposed fallback:** acquire a real .ptc from inside a workshop pak via `wb_open_resource` / pak unpack, copy to `<REPO>/tests/fixtures/synthetic/sample.ptc`; until then only error paths are covered.
5. **weapon_pose_lint** — no real `.agr` on disk. **Proposed fallback:** synthetic `<REPO>/tests/fixtures/synthetic/character_test.agr` with a minimal `GlobalTags { "WEAPON" "ADS" "STANCE" }` block.
6. **server_mod_list** — needs `<REPO>/tests/fixtures/sample-server.json` with real GUIDs as listed in TC-FS-097.

### Tools that appear UNUSED by `src/server.ts` registration list

After cross-checking the 115-tool registration block in `src/server.ts` against the assigned tool list in the task:

- All assigned tools ARE registered (no orphans on our side).
- One CAVEAT to flag: the task brief mentions `scenario_inspect (scenario_path, mode?) — mode=balance is the L8 fold-in`. The shipped tool (`src/tools/scenario-inspect.ts:303-310`) accepts ONLY `scenario_path` — `mode` is not a current parameter. The L8 "balance" fold-in is **not yet shipped**. This is documented in TC-FS-053 as a known gap.

### Notable behavior observations / cross-checks

- **find_broken_refs** takes only a `source` filter (not `sourceFilter` / `kindFilter` as the task brief said). The kind filter is not in the schema.
- **find_unused_resources** also takes only `source` (no `rootTypeFilter` despite the task brief's name). Schema: `{ source?, limit, cursor }`.
- **list_resources** takes `source`, `root_type`, `project_id` (not the brief's `rootTypeFilter` / `projectFilter` snake-case-vs-camelCase mismatch; actual schema uses `root_type` / `project_id`).
- **scenario_inspect** does NOT have a `mode` parameter (brief's mention of `mode=balance` is an L8 fold-in not yet shipped).
- **`logs_filter` / `logs_tail` / `logs_summarize_errors`** all take `which` (workbench|game) and `session` as args (the brief's signatures `(file, lines)` etc. don't match — actual signatures use `which`+`session`+`channel`).
- **Test1's `.gproj` is missing AUTHOR + VERSION** — this is great because it means `workshop_validate_manifest` + `project_validate scope=mod` against Test1 will genuinely surface real-world publish-blockers, not just trivial "no errors" results.
- **Cursor binding** for `find_references` is tight: cursors carry the GUID + kind filter. TC-FS-021 covers the cross-binding rejection.
- **No real `modded class` or `[RPC]` in Test1** — `script_overrides` and `script_find_rpc_handlers` test cases (TC-FS-075, TC-FS-086) verify the empty-result UX, not the populated-result formatter. Populated-result tests would need either a workshop addon's .c files (none unpacked) or a synthetic fixture with `modded class` + `[RPC]` decorators.

### Time-budget summary

| Bucket | Count | Examples |
|---|---|---|
| fast (<1s) | ~108 | DB lookups, file reads <1KB, simple formatters |
| medium (1–5s) | 7 | TC-FS-042 (logs_filter 223KB scan), TC-FS-043, TC-FS-046, TC-FS-062 (material disk-walk), TC-FS-071 (asset_orphan walk), TC-FS-100 (workshop scenario picker) |
| slow (5–30s) | 0 | none in this cluster |

Total estimated runtime for the full suite assuming sequential execution: under 1 minute.
