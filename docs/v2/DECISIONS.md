# 2.0 decisions

Append-only. One entry per decision, verdict or plan amendment (plan 13.1: the plan is amended
only through entries here). Format: id, date, question, experiment or input, raw result
reference, verdict, consequence.

## DEC-001 — 2026-10-01 — Topology: the 2.0 session runs in a cloud container

- **Question.** Plan 5.1 assumes the 2.0 session works in a local `<v2>` worktree beside `<repo>`
  with a live Workbench. The first 2.0 session is a cloud session (Linux container) with a clone
  of the public branch (`origin/main` = `public-release` @ `1dd8b28`).
- **Input.** Owner choice in chat (2026-10-01): execute Phase 0 / the first implementation from the
  cloud session on a new branch from `origin/main`; local-only steps go through a Remote Control
  session on the owner's PC.
- **Verdict.** Phase 0 is split by where it can run:
  - Cloud (this session, branch `claude/v2-first-implementation-2f7ydf`): items 2 (branch +
    baseline), 3 (state files), 6 (PII gate, hooks, export script), 9 (ledger skeleton), 10 (E01
    script with a synthetic fixture), 11 (harness skeleton, offline), the sandbox generator for
    item 7, and the guards of 5.1 as code (see DEC-002).
  - Owner's PC (Remote Control session or the owner): item 2's local `v2` branch and worktree from
    local `main` (this branch is merged into it), item 7's actual sandbox creation and OA-3, hook
    installation (`core.hooksPath`), the E01 run against the real `docs/v2/recon/*.md`, the
    Windows-only tests, every live item from Phase 2 on.
- **Consequence.** `STATE.md` records both locations. The branch pushed to GitHub carries no local
  history (it starts at the scrubbed public branch), so plan 5.2's "only `public-release` is
  pushable" is honoured in spirit: nothing from local `main` is pushed. The pre-push hook is
  authored here but NOT installed in the cloud clone (it would block this transport branch); it
  is installed on the owner's machine per `.githooks/README.md`.

## DEC-002 — 2026-10-01 — The 5.1 guards are implemented on this branch, offered for back-port

- **Question.** Appendix D assigns the lease, the no-autolaunch marker, the refusal of fallback
  auto-launch and the recovery rule to the maintenance session [M]; decision D1 says "server-side
  lease and no-autolaunch back-ported to `main`", which reads as developed on `v2`.
- **Input.** The cloud session cannot observe the maintenance session's tree. The Phase 0 exit gate
  needs the spawned-process test to show both refusals, which needs the code to exist in the
  tree under test.
- **Verdict.** Implemented here (`src/workbench/lease.ts`, `WorkbenchClient` changes, `wb_launch`,
  `wb_diagnose`) with the exact file schema and staleness rule of plan 5.1, plus the
  spawned-process test and `scripts/guards-check.ts`. Listed in `HANDOFF-TO-MAINT.md` as the
  back-port. If the maintenance session has meanwhile written its own, the owner picks one; the
  lease file schema and location must match plan 5.1 either way.

## DEC-003 — 2026-10-01 — Standing approval and decisions D1–D9

- **Input.** The owner set the session goal "Execute the plan. Goal is complete when all marks of
  the plan are accomplished for first implementation of v2" and confirmed the Enfusion 2.0 plan as
  the target.
- **Verdict.** Treated as approval through the end of Phase 0 (OA-1). No answer was given for
  D1–D9, so the plan's defaults apply; every default fails safe (plan 15). No live session is
  started by this programme until the owner records the D1 answer (default: "as written; no live
  session until agreed").

## DEC-004 — 2026-10-01 — `docs/v2/PLAN.md` is not copied onto this branch

- **Input.** The plan reached the cloud session as text re-typed by a local session from a read,
  not as a byte copy. The canonical file is on local `main` at `6602d39`.
- **Verdict.** This branch carries no `PLAN.md`. When the branch is merged into the local `v2`
  branch (created from local `main`), the canonical plan is already there. Everything built here
  cites section numbers of that file.

## DEC-005 — 2026-10-01 — Baseline numbers (Phase 0 item 2)

- `origin/main` @ `1dd8b28`, Node 22.22, Linux. `npm run build` clean. `vitest run`:
  1414 passed, 3 failed, 6 skipped (1423). The 3 failures are the Windows-only `tasklist` CSV
  parsing cases (`tests/server-mgmt`), already recorded as pre-existing on non-Windows by the
  maintenance work of 2026-10-01; they pass on the owner's machine. Re-run there before the Phase 0
  exit is declared.

## DEC-006 — 2026-10-01 — Branch naming

- Cloud transport branch: `claude/v2-first-implementation-2f7ydf` on the public repository.
- Local long-lived branch: `v2` with worktree `<v2>` (plan 5.1), created from local `main` on the
  owner's machine; the transport branch merges into it. Tags and `v2` stay local.

## DEC-007 — 2026-10-01 — Ledger design rulings (Phase 0 item 9)

Input: three read-only design reviews (provability, agent-proofing, query ergonomics) of plan
sections 4.1–4.7. Rulings, binding for the ledger author and later phases:

1. Validation with `zod` (existing dependency); `data/census/schema/*.schema.json` is the
   published contract and a parity test keeps the two equal.
2. Shared census library in `src/census/`; `scripts/census/*` are thin CLIs over it, so
   `src/tools/wb-census.ts` (Phase 1 item 8) can import it.
3. Physical shards: `ledger.jsonl` (core), `ledger.attribute.jsonl`, `ledger.schema.jsonl`
   (`schema-class`, `schema-key`, `property`), `ledger.diag.jsonl`; `shard_by_kind` in
   `universes.json`; ids unique across shards. This amends the single-file list of plan 4.2.
4. Id form added: `api:<Class>#attr:<member>` for E15 attribute rows of non-plugin classes.
5. `state.jsonl` is an append-only patch log (`seq, id, op, fields, evidence, session, at, by`);
   the committed file must be a byte prefix of the working file; every patch names an evidence
   record; owner sign-off is an evidence record of kind `owner-signoff`.
6. `work_item` matches `^(WI-\d+|U\d+|D\d+|P-[A-Za-z0-9-]+)$`; `WI-n` entries live in
   `docs/v2/WORK-ITEMS.md` (main-written).
7. State matrix in `data/census/state-matrix.json` (main-owned after the first write); build tag
   in `data/census/current-build.json` (written by the harness pre-flight; `unknown` until a
   Workbench build is observed, which makes T5 unreachable by construction).
8. Probe outcomes through `dispose.ts --probe`; `docs/v2/inbox/**` is invisible to every census
   script; the live-observation importer is a Phase 4 deliverable of the main session.
9. Enumerator files are kebab-case (`e01-recon-import.ts`) with the `E01` id in the header.
10. Risk is monotone upward; a downgrade needs a `dispose.ts --risk-downgrade` record.
11. `exists.ts` reads only E02, E05 and E04 observations; exact match; `NO DATA` is exit 2.
12. `query.ts` text by default, `--json` envelope, `howto` and `scan-project` stubs until Phase 3.
13. Deferred: a `validate.ts --gate G1 --quick` step in the pre-commit hook; revisit at Phase 1.

## DEC-008 — 2026-10-01 — `wb_launch` without a project while Workbench already runs

Plan 5.1 refuses to _launch_ without an explicit project. A `wb_launch` call with no `gprojPath`
while Workbench is already running launches nothing, so it is not refused: it reports the running
instance and opens the requested world as before. The refusal applies exactly when a launch would
happen. (Found by the existing `wb_*` contract tests after the guards landed.)

## DEC-009 — 2026-10-01 — Ledger author decisions accepted (Phase 0 item 9)

Recorded from the ledger author's hand-off; all accepted unless marked.

- Id forms beyond plan 4.4: `api:<Class>` (class, enum), `api:<Class>.<Member>` (enum-value),
  `plugin:<Class>` also for kind `tool`, `plugin:<Class>#attr:<m>` for plugin-setting,
  `schema:<Class>#prop:<key>` (property), `setting:<Section>/<key>` also for `option`,
  `mcp:handler-action/<Class>.<action>`, `link:<name>`, `ui:<Module>/<kind>/#<object_name>`
  (object name wins over path), generic `<dim>:<kind>/<name>` otherwise. Path segments escape
  `%`, `/` and a leading `#`. Label identity strips the mnemonic `&`, text after a tab, and
  collapses whitespace; case is kept.
- Observation header line `{$header:1, enumerator, build, generator, provisional, row_count,
inputs?, branch?, ui_language?}`; no timestamps. `parent_key` resolved to an id; `null`
  declares a root; missing blocks T1. `children_enumerated` is computed from `children_count`.
- Tier rungs as implemented in `src/census/tier.ts` (T1 counts unverifiable pak/exe/wiki refs as
  resolvable and lists them in `ledger.meta.json.unverified_refs`; repo refs need a quote on the
  cited line; T2 needs an `observes_build` enumerator on the current build; T3/T4/T5 as the
  provability design says, with the `census:<row id>` marker in test files).
- Risk: `max(risk_hint, risk_confirmed)`, downgrade only via `dispose.ts --risk-downgrade`,
  deny-list floor applied last.
- Gate phasing: G3, G7, G8 (unlinked actions), G9 are SOFT before `--phase 4`; G6 SOFT at phase
  0; G1, G2, G4, G8 dangling links and G10 findings FAIL in every phase; G5 always SOFT. G10 is
  SOFT "generic patterns only" without the owner pattern file and FAILS in that mode at
  `--phase release`.
- Extra schema files `state-patch.schema.json`, `probe.schema.json`; state patches carry `at`.
- Expected counts in `universes.json` quoted from the plan; dock 73 and toolbar 10 are [recon]
  and may need to become lower bounds. `universes.json` and `state-matrix.json` are main-owned
  from here on.
- `COVERAGE.md` records the G10 mode of the machine that ran `report.ts`; it is regenerated on
  the committing machine (here: generic-only).
- Deferred to Phase 1 or Phase 4: G4 summary self-consistency, G5 sampling, `validate.ts
--reproduce`, artifact-hash verification, `--explain`, G7 reasons, state-line authorship proof.

## DEC-010 — 2026-10-01 — Review round (finder, then refuter) on the Phase 0 deliverables

25 findings from the finder; the refuter confirmed 21, marked 3 partial and refuted 1 (the
allow-list "any path" claim). Fixed before the push:

- Lease: stale takeover and heartbeat/update/release serialised through a `<lease>.lock`
  directory with a second check under the lock; `releaseLease` refuses (LEASE_ORPHANED) while the
  recorded Workbench process still runs, so a server exit never erases an orphan; holder id gains
  a per-process nonce against pid reuse.
- `wb_launch`: refuses before the probe when another session holds the lease; refuses a
  default-mod launch while the no-autolaunch marker exists (only an explicit `gprojPath` counts).
  `wb_connect` refuses under a foreign lease without sending traffic.
- Headless spawns (`wb_cli_run`, `wb_validate_scripts`, `wb_build_data`, `mod build`) consult the
  lease through `headlessSpawnBlocker(pids, config)`.
- Harness: the no-autolaunch marker now persists across sittings and is removed only by
  `lane.ts end --release-programme` (reading of plan 5.1 guard 3: "removed at release" = end of
  programme); pre-flight step 9 waits for a session log created after the spawn and never reads an
  older one, closes the started Workbench through `onAbort` when the assertion fails, and reads
  the real `ledger.meta.json` build object; `launch.ts` drives only the `EMCP2_sandbox` addon
  unless `--any-project`; the artifacts override refuses a directory inside a git work tree;
  dry-run flags `EMCP_WB_ExecuteAction` net-calls by their path, numpad Enter spellings, and bare
  characters (menu mnemonics).
- Gates: the PII gate decodes UTF-16 before the binary test, scans oversize text up to 64 MB and
  reports anything larger as a finding, never allow-lists an owner-pattern match, and accepts
  `{path, pattern}` allow entries so third-party addresses from the public wiki export are no
  longer copied into the allow-list; G10 fails without the owner pattern file unless `CI` is set
  (so `validate.ts --all` is run with `CI=1` in this container); the pre-push hook also rejects a
  `public-release` commit that descends from local `main` or `v2`; `guards-check` compares the
  foreign lease byte for byte.

Left for later phases (recorded, not fixed): dry-run exception bound to the declared script name
(F-11); T1 counting pattern-conforming but unverifiable refs as resolvable (F-17, see DEC-009);
`diagnose()` still sends one read-only ping under a foreign lease (reported in its output).

## DEC-011 — 2026-10-01 — E01 mapping rewritten from the real recon vocabulary

The first E01 run on the owner's PC (Tools 1.8.0.13, eight real recon files) emitted 0 rows:
127 tables dropped, 87 of them "no coverage column", because the mapping guessed header names
that the files do not use. The PC session reported the real vocabulary read-only (header sets,
every distinct Kind, coverage and Confidence cell, the Appendix B table, example rows, probe
headings) and the mapping is now version 2:

- Every feature table has the header `Feature | Kind | What it does | Script API | Automation
path | Current MCP coverage | Evidence | Confidence` (with or without parenthesised notes);
  the coverage column is found by "current mcp coverage", "status" is no longer a coverage
  synonym.
- Coverage cells: "none …" (2,011 rows), "shipped", "partial…" anywhere in the cell, or a
  snake_case tool name read as covered; ordered regular expressions in `coverage_patterns`.
- Kind cells (about 290 spellings) go through `normalizeKind`: bracketed and parenthesised
  parts, `->`/`,`/`/` tails, `xN` counts and the qualifiers LIVE/FILE/KNOW/CLI/PROC/UDP are
  removed, then the phrase, its singular, its suffixes (head noun last) and its prefixes are
  looked up. A count in the kind cell ("control (3)", "NetApiHandler, 7 actions", "plugin x4")
  marks the row aggregate, as does " / " between several features in the label.
- Readings taken without seeing every file (listed in the mapping `$comment`, to be checked by
  the REVIEWER pass): "action" and "menu-action" are menu items; audio and animation graph node
  kinds are classes; "editor", "sub-editor", "viewer" are windows; "option (property)" is an
  option. Knowledge kinds (architecture, knowledge, data, protocol, …) are left unmapped so the
  rows are reported as dropped rather than forced into the vocabulary.
- Beyond the plan fields: the "Automation path" cell becomes `paths_proposed` (reason from the
  parenthesised detail; "n/a" proposes nothing), tool names in the coverage cell become
  `covers_proposed` (handler names `emcp_*` excluded, and nothing for "none"), and api-side rows
  keep the "Script API" cell as `signature`. The "Confidence" column is ignored (E01 is capped at
  low). A label prefix naming a module ("Script Editor: Build > Compile All") sets the module.
- "5. Proposed 2.0 work items" tables are skipped by heading (reported as skipped, not dropped);
  "Known limitations and open items" and "Unknowns …" material seeds probes.

The first run's empty observation file and its 208 seeded probes were not committed on the PC;
the E01 run is repeated there with this mapping.

## DEC-012 — 2026-10-01 — Windows results of the Phase 0 local half

Run on the owner's PC in the new `v2` worktree (local `v2` = local `main` 6602d39 plus the
branch's commits cherry-picked; `docs/TEST-RESULTS.md` conflict resolved by keeping local
`main`'s already-scrubbed line). Build clean; `guards-check` PASS on both cases; sandbox
`EMCP2_sandbox` created (initial commit b8eeeab, OA-3 pending); Tools build 1.8.0.13 read from
the executable's file metadata without running it.

- Suite: 7 failures, all Windows-only and all in files from this branch, fixed here (commit
  "Tests: Windows portability …"): the live-harness CLI tests spawned `node_modules/.bin/tsx`
  (a shell script; `spawnSync` gives status null on Windows) and now run `node --import tsx`;
  the export test built a path from `new URL(import.meta.url).pathname` (`\C:\…`) and now uses
  `fileURLToPath`; its fixture relied on the executable bit that `core.fileMode=false` ignores
  and now sets the index mode explicitly; the pre-commit hook test runs three `npx tsx` hook
  invocations and gets a 120 s timeout; the evidence test expects the platform separator in a
  placeholder path.
- Owner PII pattern file (OA-9): the PC session first listed public addon names in it. `Test1`
  occurs 217 times in public history, so the gate flagged committed public content. Rule
  recorded: the file holds only names absent from `origin/main` (account name first); it now
  holds 8 patterns. With it, `pii-gate.ts --tree` reports one finding, a home path in the
  local-only `docs/v2/REVIEW.md:234` (owner to scrub, OA-10).
- Public history already carries the account name in one line of `docs/TEST-RESULTS.md` (the
  home path scrubbed by local `main` 6602d39 and by this branch at the tip); the history itself
  is not rewritten (D8). The six case-insensitive hits in `data/wiki/export.xml` are other
  people's wiki user names, not the owner's. Recorded as OA-11 for the owner's decision.
