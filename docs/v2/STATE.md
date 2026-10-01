# 2.0 state

Updated: 2026-10-01 Build: unknown / stable / unknown (no Workbench observed yet) v2 @ see `git log -1` on branch `claude/v2-first-implementation-2f7ydf` Served dist: `main` @ 1dd8b28 (public) — the registered server on the owner's machine serves local `main`
v2 working directory: `<repo>` clone in a cloud container (DEC-001); branch pushed to GitHub as `claude/v2-first-implementation-2f7ydf`; local `<v2>` worktree being created by a Remote Control session on the owner's PC 2.0 sandbox project: not created yet (generator: `npx tsx scripts/live/create-sandbox.ts`)
Phase: 0 / work package: Phase 0 items 2, 3, 6, 9, 10, 11 (cloud) / step: exit gate, cloud half done; finder/refuter round applied (DEC-010)
Next action (one line): the owner's PC session runs the local half (local `v2` branch + worktree with the two commits cherry-picked, hooks, OA-9 pattern file, Windows suite, guards check, sandbox, E01 on the real recon, census build/validate/report); results are recorded here afterwards.
In flight (uncommitted work, with file list): none
Open train: none
Lease: free (no live sitting has happened; `~/.enfusion-mcp/workbench.lease.json` untouched on the owner's machine)
Blocked on owner: OA-1 (phase approval beyond 0), OA-2, OA-3, OA-4, OA-9, D1–D9 answers (defaults applied, DEC-003)
Unknowns still open: all of section 7 (U1–U40); none settled (Phase 0 is offline)
Coverage: 0 / 0 / 0 (empty skeleton); frontier: 0; enumerators pending: E01–E19, L01–L17
Last live session: none; snapshot diff: n/a
Workflows in flight: none
Budget used against estimate: Phase 0 about 2.5M tokens of agent work plus the main session (estimate 1–2M)
Plan approved through: Phase 0 (DEC-003) Decisions: defaults
Per-session goes in force: none

## Phase 0 exit gate — status

| Gate item (plan 8, Phase 0)                                                             | Status here (Linux cloud)                                                                                                                                                                                                               | Remaining on the owner's PC                                                                                                                                                                              |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Suite green on `v2`                                                                     | 1747 passed, 3 failed, 6 skipped. The 3 failures are pre-existing Windows-only cases (`tests/server-mgmt/launch.test.ts` pidFilePathFor, `tests/workbench/cli-runner.test.ts` taskkill and tasklist CSV) that fail on `origin/main` too | Re-run `npx vitest run --pool=forks --poolOptions.forks.singleFork` on Windows                                                                                                                           |
| `report.ts` prints a tier histogram                                                     | Yes: `npx tsx scripts/census/report.ts --summary` prints gates then `T0 0 … T5 0`                                                                                                                                                       | —                                                                                                                                                                                                        |
| Spawned-process test of 5.1 (live call refused under a held lease; auto-launch refused) | Yes: `tests/workbench/spawned-guards.test.ts` and `npx tsx scripts/guards-check.ts` against the built `dist/` (2 PASS)                                                                                                                  | Same against the `dist/` that the registered server serves, after the guards reach `main`                                                                                                                |
| Pre-push hook rejects `v2` in the stdin test or against a local bare repo               | Yes: `v2` and `main` rejected, `public-release` accepted (stdin test; `tests/scripts/githooks.test.ts`)                                                                                                                                 | Install: `.githooks/README.md`                                                                                                                                                                           |
| PII gate finds a planted path in a fixture                                              | Yes: `tests/scripts/pii-gate.test.ts` and a manual run                                                                                                                                                                                  | Create `%LOCALAPPDATA%\enfusion-mcp\pii-patterns.txt` (OA-9)                                                                                                                                             |
| 2.0 sandbox exists and is clean (5.1)                                                   | Not possible here                                                                                                                                                                                                                       | `npx tsx scripts/live/create-sandbox.ts` in the Workbench addons dir, then OA-3                                                                                                                          |
| Guards live on `main` (item 5, [M])                                                     | Implemented on this branch (DEC-002)                                                                                                                                                                                                    | Back-port to `main`, rebuild `dist`, restart both clients (OA-2)                                                                                                                                         |
| E01 recon rows imported (item 10)                                                       | Script and synthetic-fixture tests only; real `docs/v2/recon/*.md` are local                                                                                                                                                            | `npx tsx scripts/census/enumerators/e01-recon-import.ts --recon docs/v2/recon --build <tag>` then `build.ts`, `validate.ts --all`, `report.ts`; correct `e01-mapping.json` where the real headers differ |

## What this branch contains (Phase 0 deliverables)

- `src/workbench/lease.ts`, guard changes in `src/workbench/client.ts`, `src/tools/wb-launch.ts`, `src/tools/wb-diagnose.ts`, `src/tools/wb-connect.ts`, `src/server.ts`; `scripts/guards-check.ts`; tests under `tests/workbench/`, `tests/tools/wb-launch.test.ts`.
- `scripts/pii-gate.ts`, `scripts/pii-allow.json`, `scripts/export-public.ts`, `scripts/export-allow.json`, `.githooks/{pre-push,pre-commit,README.md}`; tests under `tests/scripts/`.
- `scripts/live/**` (lane, preflight, postflight, snapshot, launch, netcall, capture, evidence, dry-run, create-sandbox, mocks); tests under `tests/live-harness/`.
- `data/census/**` (schemas, `universes.json`, `state-matrix.json`, `policy.json`, `current-build.json`, `g4-rules.json`, `known-defects.json`, empty state/probes/aliases, empty shards and meta), `src/census/**`, `scripts/census/**` (build, validate, reconcile, promote, dispose, report, exists, query, alias, `enumerators/e01-recon-import.ts`); tests under `tests/census/`.
- `docs/v2/{DECISIONS,LIVE-LOG,HANDOFF-TO-MAINT,COVERAGE,STATE}.md`, `docs/v2/sessions/`, `docs/v2/inbox/`; `docs/CONVENTIONS.md` census marker.
- Not on this branch by decision: `docs/v2/PLAN.md` (DEC-004).

## Re-orientation (plan 13.3) for the next session

1. Read this file, the last three `DECISIONS.md` entries, the last `LIVE-LOG.md` entry.
2. `git status --short`, `git log --oneline -5`; compare with the line above.
3. `npx tsx scripts/census/report.ts --summary`.
4. Run the suite if the tree is dirty.
5. No live step is next: the lease is free and nothing is held.
6. State the next action in one line before starting.
