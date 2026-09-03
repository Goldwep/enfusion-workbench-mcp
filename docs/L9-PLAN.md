# L9 execution plan — public release readiness

**Prereqs:** L7 + L8 complete. All 16+ deferred audit-fix items addressed.

**Estimated:** 1 session. **No new MCP tools** — solidification + release gates.

## L9-1 Security audit (apply remaining deferred items)

Address the 16+ critical/high items captured across the 5 prior audit cycles:

**From L4→L5 audit (highest priority):**
- C-1 — `atomicCommit` Windows-process-kill atomicity → write-then-rename + journal file + watcher-freeze
- C-2 — `isGitClean` conflates outside-repo with dirty → split into `GitState` enum
- C-3 / BUG-2 — `listIndexedProjectFiles` INNER JOIN drops untyped files → schema v3 with `files.project_id` column or LEFT JOIN

**From L3→L4 audit:**
- L3 H-1 — `crawlReady` Promise for L3+ tools using ProjectIndex
- L3 H-3 — `RedactedServerConfig` brand pattern instead of literal-string types
- L3 SEC-002 to SEC-005 — path-traversal + content-leak in error paths

**From L6→L7 audit:**
- A1 — shared `parseScriptCached(filePath)` LRU (256 entries) — kills 3× re-parse
- A2 — move `findCFiles` from script-overrides.ts to `src/script-parser/walk.ts`
- S1 — `src/utils/path-guard.ts` with project-roots allow-list, applied to every tool
- S2 — `parseScript` size cap (2 MB)
- S3 — single-file tools `lstatSync` symlink reject
- C2/C3/C7 — parser recovery edge cases

## L9-2 Type-enforced redaction lock-down

- Add eslint rule banning raw `ServerConfig` import outside `src/tools/server-*.ts`
- Snapshot tests for `redactServerConfig` — any new `passwordAdmin` leak fails CI
- Audit every `logger.*` call for potential secret echo

## L9-3 BI attribution review

- `LICENSE` — verify steffenbk upstream attribution complete
- `README.md` — Bohemia Interactive tools-EULA compliance review
- `docs/FORK-NOTES.md` (new) — explain divergence from steffenbk
- Verify EMCP_WB_*.c handlers don't violate the tools-EULA's JsonApiStruct subclassing rules

## L9-4 Pre-publish hook

- `workshop_validate_manifest` (L3-6 shipped) fails publish if `Scripts/WorkbenchGame/EnfusionMCP/` directory exists in the project being published — prevents accidental dev-handler ship
- Add `workshop_pack` (currently L3 deferred) — bundles to disk via `-wbModule=ResourceManager -packAddon -packAddonDir`

## L9-5 Error UX pass

- Every tool's failure mode emits structured `{error, hint}` not `Error: undefined`
- Audit table in `docs/ERROR-UX.md` enumerating each tool's error states + their hints
- Standardize "EMCP handler not deployed" messages across all L7 wrappers (currently each has its own phrasing)

## L9-6 Docs polish

- `quickstart.md` v2 — covers L7 EMCP handler deployment, L4 byte-edit safety, L5 refactor workflows
- `TOOL_TEMPLATE.md` — updated with the cursor-helper pattern, EMCP-handler pattern, planFileEdit pattern
- Per-cluster docs: `docs/TOOLS-SCRIPT.md`, `docs/TOOLS-TERRAIN.md`, `docs/TOOLS-REFACTOR.md`, etc.

## L9-7 Automation

- CI matrix already exists; add release script `scripts/release.sh`
- `npm publish` setup (if going public)
- GitHub release with changelog auto-gen from commit log

## L9-8 Public-vs-private decision

Per the maintainer's intent: "personal tool for awhile and may be posted for public use later." L9 is the gate. Outputs:
- v1.0.0 tag
- Public release announcement (Reddit / Discord / BIKI)
- OR continue as private with a documented "ready to publish when desired" state

## Verification (release-blocking)

- Full test suite green (`npx vitest run --pool=forks --poolOptions.forks.singleFork`)
- Smoke run clean
- Fresh-checkout install completes ≤5 min following `quickstart.md`
- All ~120 tools enumerable via MCP `tools/list`
- No `passwordAdmin` / RCON / persistence-API-key strings surface in any tool output sample under grep

## Tag v1.0.0 at L9 close
