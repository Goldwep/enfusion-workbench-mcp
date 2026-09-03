# L2 Ultraplan — Enfusion Workbench MCP — Goldwep

**Status**: drafted at end of L1, awaiting review.
**Predecessor**: L1 (commits `1f11762` → `46e026f`) delivered the project-index foundation, three query tools, and the file watcher.
**Goal**: turn the L1 foundation into a tool surface that genuinely accelerates Reforger / Arma 4 mod work — by indexing the full installation (not just the active project), exposing richer refactor queries, and fixing the cleanup items L1 surfaced.

---

## SITUATION

L1 shipped:

- A SQLite project-index (resources, resource_refs, files, projects, project_deps).
- Scanner + crawler indexes one source root (user mods).
- Three query tools: `resolve_guid`, `find_references`, `project_index_status`.
- A chokidar-based file watcher that incrementally re-indexes on save.
- 18 new project-index tests + 4 watcher tests + 20 tool tests; full suite 487 / 2 skipped.

What L1 left on the table:

- **Single source only**. Crawler accepts multiple `CrawlSource[]` but server.ts wires only the user project path. Workshop mods + base-game core are unreachable to the tools.
- **No reverse queries**. `find_unused_resources` and `find_broken_refs` are the natural follow-ons; both shippable in days now that the index exists.
- **No inheritance traversal**. `parent_inherit` is stored as a raw `"{GUID}path"` string; no API to walk the chain.
- **No `project_id` FK on resources**. Per-project resource counts are currently approximated via the `source` column.
- **Serializer bug** in upstream's `enfusion-text.ts` is still skipped — emits `ID TestMod` (bare) instead of `ID "TestMod"` (quoted). Doesn't affect L1 (read-only) but blocks any future round-trip tool.
- **SubScene resources** (no own GUID, just a `Parent` pointer) get flagged as scan errors. Cosmetic but noisy.
- **Watcher isn't started at server boot**. The class works; nothing instantiates it from `registerTools`.
- **DRY pass deferred** — `resource-scan` + `ref-scan` + `crawler` each carry their own copy of the GUID regex, the path-normalization, and the walk-skip-dirs set.

---

## MISSION (L2 deliverables)

1. **Multi-source crawling**: index user + workshop + core in one pass, config-driven.
2. **`project_id` FK migration** + proper per-project counts everywhere.
3. **Five new query tools**: `find_unused_resources`, `find_broken_refs`, `inheritance_chain`, `list_resources`, `list_dependencies`. All paginated, all bounded-output.
4. **ProjectIndex wrapper class** matching upstream `SearchEngine` shape (per CONVENTIONS adoption notes).
5. **Watcher integrated at server startup**, with SIGINT shutdown.
6. **Cleanup batch**: enfusion-text serializer fix (unskip test), SubScene non-error classification, shared helpers extracted.

After L2, the index covers everything Reforger ships + user installs, and refactor-grade queries land in single-digit ms.

---

## EXECUTION — phased, with parallelism map

### Phase L2-0 — Pre-flight reads (PARALLEL, ~30 min)

Skipped — the L1 conventions/template docs are still current. Re-read individually if a sub-task needs a refresher.

### Phase L2-1 — Schema v2 migration (SOLO, ~½ day)

**Critical path** — every downstream phase depends on the new column.

1.1 Add migration v2 to `migrate.ts`:
- `ALTER TABLE resources ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL`
- Backfill `project_id` from `file_path` via a one-time JOIN against `projects.root_path`
- Bump `currentSchemaVersion()` to 2

1.2 Update types and inserts:
- `ResourceRow.project_id: string | null`
- `resource-scan.ts` upsert receives `project_id` from caller (crawler knows it)
- Crawler passes it via the `onParsed` callback's contract or a new param

1.3 Update `project_index_status` to use the FK join instead of the `source` approximation. Remove the "approx by source" caveat.

**Tests**: schema apply (v1 → v2), backfill correctness, FK ON DELETE SET NULL behavior.

**Checkpoint**: re-run smoke against existing DB; existing rows get backfilled, new rows write the FK correctly.

### Phase L2-2 — Multi-source crawl + watcher startup (SOLO, ~½ day)

2.1 Add env vars + config fields:
- `ENFUSION_CORE_PATH` → `<Workbench install>/Workbench/addons`
- `ENFUSION_WORKSHOP_PATH` → `~/Documents/My Games/ArmaReforger/addons`
- Defaults derived from existing `workbenchPath` / `gamePath`

2.2 Update `server.ts` startup:
- Build `CrawlSource[]` from config (skip absent paths gracefully)
- Run an initial `crawl(...)` once at boot
- Instantiate `ProjectWatcher` per source; start them all
- Register a SIGINT handler that stops watchers + closes the DB

2.3 Update `scripts/smoke.ts` to crawl all sources.

**Tests**: integration test that opens a temp dir with two fake projects under different sources and verifies they're both indexed with the right `source` column.

**Risk**: starting multiple chokidar watchers eats file handles. Cap at three (user/core/workshop); document if user wants more they can configure custom.

### Phase L2-3 — ProjectIndex wrapper class (SOLO, ~1 day)

Per CONVENTIONS adoption notes — give the project-index the same shape as upstream's `SearchEngine`.

3.1 Create `src/project-index/loader.ts`:
- `class ProjectIndex` constructor takes `(dbPath: string)`, opens via `openProjectIndex`, exposes a `db` getter for SQL-heavy tools, plus query methods like:
  - `resolveGuid(guid): ResourceRow | undefined`
  - `findReferences(guid, kind, limit, offset): { rows, totalCount }`
  - `listResources(filter, limit, offset): { rows, totalCount }`
  - `findUnusedResources(filter, limit, offset): { rows, totalCount }`
  - `findBrokenRefs(limit, offset): { rows, totalCount }`
  - `inheritanceChain(guid): ResourceRow[]`
  - `status(): { totals, projects[] }`
  - `reload()` — close + re-open the DB (used by watcher when schema migrates)
- Coalesce concurrent reload via `private reloading: Promise<void> | null` (per CONVENTIONS §4).

3.2 Refactor the three L1 tools to depend on `ProjectIndex`:
- `registerResolveGuid(server, index: ProjectIndex)`
- `registerFindReferences(server, index: ProjectIndex)`
- `registerProjectIndexStatus(server, index: ProjectIndex)`

3.3 Update `server.ts` to instantiate `ProjectIndex` once and thread through.

**Tests**: ProjectIndex class behavior + reload coalescing + all three existing tool tests pass with the new dep.

**Risk**: this touches existing code. Land in one commit with a focused diff so review is tractable.

### Phase L2-4 — Five new query tools (SQUAD-5, ~1-1.5 days)

**Biggest natural parallel win.** Each tool is a fresh file in `src/tools/` + a test in `tests/tools/`. They share only `ProjectIndex` and the cursor utility.

Tools to build (one squad worker per tool):

- **`find_unused_resources`** — paginated. Filter by `source` and/or `root_type`. Returns resources with `(SELECT COUNT(*) FROM resource_refs WHERE target_guid = resources.guid) = 0`. Critical for refactor sweeps.

- **`find_broken_refs`** — paginated. Refs whose `target_guid NOT IN (SELECT guid FROM resources)`. Helps detect missing dependencies. Filter by `ref_kind`.

- **`inheritance_chain`** — given a GUID, walks `parent_inherit` chain. Returns ordered list of resources from leaf → root. Bounded by max-depth (e.g. 20) to prevent runaway. Output is small (1-20 rows); single page, no cursor.

- **`list_resources`** — paginated browse. Filters: `source`, `root_type`, `class_name LIKE`, `project_id`. Default sort by `last_indexed DESC`. Cursor-paginated.

- **`list_dependencies`** — given a project id, returns project_deps rows joined with resolved project titles (if dep guid matches a project's guid). Recursive option for transitive deps (depth-cap 5).

Common cursor lib: extract `encodeCursor`/`decodeCursor` from `find-references.ts` into `src/tools/_cursor.ts` (the underscore signals "shared util, not a tool") before the squad starts. Each worker imports it.

**Pre-squad**: I extract the cursor helper.

**Quality bar per worker**: build clean, tests pass, lint 0 errors, exported pure formatter unit-tested per TOOL_TEMPLATE.

### Phase L2-5 — Cleanup batch (PARALLEL-of-1 + SOLO, ~½ day)

5.1 **Serializer fix** — delegate to one agent in isolation:
- Read upstream's `enfusion-text.ts` serializer rules
- Decide on the right always-quote-strings policy (only emit bare for `true`/`false`/numeric)
- Update `serializeNode`, unskip `enfusion-text.test.ts > serializer > "serializes minimal node"`, verify the four other serializer tests still pass

5.2 **SubScene non-error classification** — solo:
- In `resource-scan.ts`, when `extractGuid` returns null but `parse` succeeded, log at `debug` (not as an error)
- Add an `unindexable: string[]` field to `ScanResult` for files that parsed but had no GUID
- Update smoke to display unindexable separately from errors

5.3 **DRY pass** — solo:
- Extract `GUID_RE` and `parseGuidRef` from resource-scan + ref-scan into `src/project-index/_guid.ts`
- Extract `SKIP_DIRS` walk helper from resource-scan + crawler into `src/project-index/_walk.ts`
- Run tests after each extraction; commit per-helper

### Phase L2-6 — Documentation + release prep (SOLO, ~½ day)

6.1 Update `docs/quickstart.md` to reflect L2 tools.

6.2 Create `CHANGELOG.md`:
- v0.1.0 (L1): foundation
- v0.2.0 (L2): multi-source, expanded queries, ProjectIndex class

6.3 Tag the L1 → L2 boundary:
- `git tag v0.1.0 46e026f` (L1 final)
- After L2 completes: `git tag v0.2.0 <commit>`

6.4 Consider flipping repo public — depends on the maintainer's call. README already credits upstream.

---

## ANNEX A — Schema v2 SQL

```sql
-- Migration v2: add project_id FK to resources for proper per-project counts.

ALTER TABLE resources ADD COLUMN project_id TEXT
  REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_resources_project ON resources(project_id);

-- Backfill: for each resource, find the project whose root_path is a prefix
-- of the resource's file_path (resources store relative paths, projects
-- store absolute root_path).
-- This is approximate — exact attribution requires knowing the project root
-- at scan time, which the crawler now passes via the onParsed callback's
-- ScanContext (added in Phase L2-1.2).
UPDATE resources
SET project_id = (
  SELECT p.id FROM projects p
   WHERE resources.file_path LIKE p.id || '/%'
      OR resources.file_path LIKE '%/' || p.id || '/%'
   LIMIT 1
);
```

## ANNEX B — Squad / delegation map

| Phase | Mode | Why |
|---|---|---|
| L2-0 | (skipped) | L1 docs still current |
| L2-1 | Solo | Schema is one focused change; mistakes have wide blast radius |
| L2-2 | Solo | Server-startup wiring; coordinates many existing pieces |
| L2-3 | Solo | Refactor existing code (tools depend on new class); easier single-thread |
| L2-4 | **Squad-5 implementing** | Five independent tool files, biggest parallel win |
| L2-5.1 | Solo agent | Isolated serializer fix; well-scoped |
| L2-5.2 | Solo | Small touch across smoke + resource-scan |
| L2-5.3 | Solo | DRY extraction; commit-per-helper to keep diffs reviewable |
| L2-6 | Solo | Docs + tagging |

Total parallel agents across L2: **6** (1 cleanup + 5 query-tool squad). Trust-but-verify on each.

## ANNEX C — Estimates + risk

- **Total estimate**: 4-7 working days (similar shape to L1; slightly longer because Phase L2-3 ProjectIndex refactor touches existing code).
- **Critical path**: L2-1 (schema) → L2-3 (ProjectIndex) → L2-4 (squad).
- **Off-critical-path**: L2-2 (multi-source) parallel to L2-1; L2-5.1 (serializer) parallel to anything.
- **Risks**:
  - **Schema migration on existing DBs**: the backfill UPDATE relies on the relative-vs-absolute path shape. If real-world `file_path` strings deviate from the test fixtures, backfill may miss rows. Mitigation: a `project_id` column nullable, NOT NULL constraint deferred.
  - **ProjectIndex refactor merge surface**: any in-flight tool changes during the refactor cause friction. Mitigation: land L2-3 in a clean commit window, no concurrent work.
  - **Chokidar watcher count**: 3 simultaneous watchers on Windows can hit handle limits. Mitigation: detect EMFILE-style errors and surface clearly.
  - **`find_unused_resources` perf**: anti-join query is O(N×M) without index. The `idx_refs_target` index makes it index-only — fast for ≤100k resources, may need tuning beyond that.

## ANNEX D — What's intentionally *not* in L2

These wait for L3 unless promoted:
- **L5 log tailer** — live tail of Workbench/game `script.log` / `console.log` / `error.log` with structured error parsing. Independent of project-index, high user value but no urgency.
- **L6 Workshop scraping** — pull mod metadata + screenshots from `reforger.armaplatform.com/workshop/<id>`. Requires HTML-scraping or Playwright; touches network. Defer.
- **L4 CLI bridge** — wrap `ArmaReforgerWorkbenchSteamDiag.exe` flags. Flag inventory captured in L1 strings extraction; tool surface design needs its own ultraplan.
- **Cross-engine support** — DayZ Enforce Script API alongside Reforger. Scope creep for now; revisit when Arma 4 lands.
- **Public release polish** — CONTRIBUTING.md, issue templates, release automation. Punt to L3 unless we go public sooner.

---

## COMMAND/SIGNAL

Ready for your review. If green, the natural kickoff is L2-1 (schema) since everything else depends on it.

Want any phase resequenced, added, or dropped? If a squad of 5 in L2-4 feels too aggressive on tokens, we can run them as 2 + 3 in two waves.
