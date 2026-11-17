# Game-update playbook

What to do when Bohemia ships an Arma Reforger / Arma Reforger Tools update. Written after absorbing the 1.6 → 1.7 (`stable_1_87_80`) update, which broke the API scraper in two ways and re-GUID'd base content. The pattern generalizes.

## The two mechanical refresh steps

### 1. Re-scrape the API index

```bash
npm run scrape
```

Reads the Doxygen zips from `ENFUSION_WORKBENCH_PATH` and rebuilds `data/api/`. Check `data/api/scrape-meta.json` afterward — it records when/where the scrape ran and the detected Jenkins build branch (e.g. `stable_1_87_80`), so staleness is detectable without diffing a 47 MB JSON.

Failure modes already survived once (and now guarded, but verify the guards held):

- **Zip layout changes.** The 1_87_80 build moved the Doxygen HTML under an extra `html/` directory; an unguarded scraper parses 0 classes _silently_. `resolvePrefix()` auto-detects the layout — if a future build restructures again, the scrape log will show `0 classes` and `writeClassesPreserving` will refuse to blank the existing data.
- **A source zip disappearing.** BI consolidated the standalone Enfusion zip into the combined Arma zip. The writer preserves prior data on an empty scrape rather than destroying it; a genuinely intended removal requires deleting the JSON by hand.
- **Pak container generation change.** 1.8 (HEAD version 3) changed two things inside `.pak` files at once: entry offsets became **absolute** file positions (previously DATA-relative) and compressed payloads gained a **zlib wrapper** (previously raw deflate). Symptom: every `game_read`/`asset_search` on packed content failing with zlib "invalid block type" / "invalid stored block lengths". The VFS now version-hints from HEAD, sniffs the RFC-1950 header per entry, verifies decompressed length, and locks the verified mode per pak — both generations are supported, so a future flip back won't break either. If a future update fails again with both interpretations exhausted, hex-dump one entry's first bytes (zstd magic `28 B5 2F FD`, LZ4 `04 22 4D 18`) before touching the reader.
- **Zips replaced by unpacked directories.** The 1.8 Tools build stopped shipping zips entirely: the docs now live at `Workbench/docs/ArmaReforgerScriptAPIPublic/` and `Workbench/docs/EnfusionScriptAPI/` (note the Enfusion rename — no "Public" suffix — and that the standalone Enfusion API returned after 1.7 consolidated it). `resolveDocsSource()` probes zip-then-directory, so both layouts work; `scrape-meta.json` records which `kind` was used.

After a successful scrape, compare class counts against the previous `scrape-meta.json` era — a large _drop_ is a red flag; growth is normal.

> **Size watch:** `data/api/arma-classes.json` is ~46 MB and grows with every re-scrape (each game update adds classes). GitHub warns at 50 MB and **hard-blocks pushes at 100 MB**. There's headroom for years at the current growth rate, but if it ever approaches the limit, move the file to Git LFS or split/compact the index format before pushing.

### 2. Re-verify the hardcoded GUID tables

Base-game GUIDs can change between versions (observed in 1.7: `SCR_CampaignBuildingDisassemblyUserAction` changed GUID). The repo carries literal GUIDs in a few known places — after an update, re-probe them against the install's `resourceDatabase.rdb` or the live Workbench:

- `src/templates/scenario.ts` — prefab + component GUIDs used by the Conflict-scenario generator
- `src/server-mgmt/scenario-picker.ts` — the `OFFICIAL_SCENARIOS` catalog
- Scattered singletons: `src/tools/config-create.ts`, `src/tools/building-setup.ts`, `src/tools/asset-search.ts`, `src/tools/game-duplicate.ts`, `src/templates/gproj.ts` (base-game dependency GUID)

`find_broken_refs` over an indexed project is a quick smoke: prefabs still referencing a re-GUID'd base resource show up immediately.

### 3. Refresh the wiki knowledge base (manual browser step)

`data/wiki/pages.json` holds the Community Wiki modding pages that back `wiki_search`. It is refreshed from a MediaWiki XML export, **not** by scraping.

> **Why manual:** as of 2026-08-12, community.bistudio.com fronts a Cloudflare challenge that blocks both headless and headed Playwright (`scripts/scrape-wiki.ts` is dead — see its header), and `api.php` returns 403 to scripted fetches. BI publishes no database dumps. `Special:Export` in a real, human-driven browser session is the legitimate route, and it's what produced `data/wiki/export.xml` in the first place. Do not attempt to bypass the challenge.

Procedure:

1. Print the current page set as a paste-ready title list:

   ```bash
   npx tsx scripts/list-wiki-titles.ts
   ```

2. In your own browser, open <https://community.bistudio.com/wiki/Special:Export>.
3. Paste the title list into the big textarea. To also pick up **new** pages, type `Arma Reforger/Modding` into _Add pages from category_ and click **Add** — note this adds only direct members, so repeat for any subcategories you care about (browse [Category:Arma Reforger/Modding](https://community.bistudio.com/wiki/Category:Arma_Reforger/Modding) to see them; the parser skips category/template pages, so over-including is harmless).
4. Check _Include only the current revision_, leave _Include templates_ unchecked, check _Save as file_, and click **Export**.
5. Save the download over `data/wiki/export.xml`.
6. Convert and merge (preserves the non-wiki `enfusion` engine-doc entries in pages.json):

   ```bash
   npx tsx scripts/parse-wiki-export.ts
   ```

7. Sanity-check the reported page count against the previous run (251 bistudio pages as of the 2026-05-21 refresh) — a large drop means a broken export, not a shrunken wiki.
8. Restart the MCP client — the server reads `pages.json` from disk at startup.

Occasionally worth re-testing whether the Cloudflare posture has relaxed (`scrape-wiki.ts` would then work again), and whether an interactive browser-extension session (Claude driving the user's real logged-in Chrome) is available as an alternative fetch path.

## What does NOT need attention

The Node-side query/refactor/index logic is version-agnostic — it operates on the text-container grammar and the SQLite index, neither of which BI's updates touch. If something in that layer breaks after an update, it's a pre-existing bug surfacing, not drift.

## What needs a live re-test

The EMCP Enforce handlers (`mod/Scripts/WorkbenchGame/EnfusionMCP/*.c`) call Workbench APIs **by name**. An engine update can rename/remove those APIs (breaking a handler) or fix engine-side bugs the server currently works around. After each update, re-test against a running Workbench:

- `wb_validate` — the BI `ValidateMaterialPlugin` had VM-exception crashes on unresolvable paths (this server prechecks paths to avoid triggering it; an engine fix would make the precheck belt-and-suspenders)
- `wb_resources getInfo` on `.ent` files — engine-side "unsupported resource type" limitation
- `wb_entity_modify setProperty` on **component** properties — `SetVariableValue` returns false for component-level writes (top-level properties work); an update may open a proper path
- Any handler that starts returning "Undefined API func" — that's the rename signal

## Script-API migration awareness

Major updates deprecate/rename script APIs (1.7 examples: `SCR_Faction.GetRankName()` → `GetRanks().GetRankName()`, async `SaveGameManager`, stricter animation graphs where unnamed/unused nodes became **errors**). The re-scraped API index picks these up automatically for `api_search`, but generated-code templates (`script_create` output, KB pattern files) may reference deprecated forms — grep the templates for any API the changelog lists as changed.

## Census steps for a new build

The census (`data/census/`) holds one row per Workbench surface and the evidence behind each tier. A new game build makes some of that evidence stale. Work in this order; every command runs from the repo root. `--build <tag>` defaults to the `tag` in `data/census/current-build.json`, so set that file to the new build first (record the old build under `carry_over` only if its live walks are being accepted for the new one, with the evidence id that says so; accepting a carry-over is the owner's call, as EV-s019-carry-001 was for 1.8.0.13 to 1.9.0.37).

Before the enumerators: run `npm run scrape` (checklist item 1; E12 reads `data/api/`), refresh `data/wiki/export.xml` (checklist item 3; E07, E09, E14 and E16 read it), and take the registry export E06 reads, after Workbench of the new build has run once: `reg export "HKCU\Software\Bohemia Interactive\Arma Reforger Workbench" <artifacts>/census/<new build>/E06/workbench-registry.reg` (UTF-16, the form `reg export` writes). Without it E06 prints NO DATA and exits 2. `<artifacts>` is `%LOCALAPPDATA%\enfusion-mcp\artifacts` unless `ENFUSION_ARTIFACTS_DIR` says otherwise. The enumerators that read the installs need `ENFUSION_GAME_PATH` and `ENFUSION_WORKBENCH_PATH` (or the config file) to point at them.

To rehearse the offline part without touching the committed ledger, run `npx tsx scripts/census/update-drill.ts --from <old build> --to <new build> --scratch <empty folder outside the repo> --fold-live` once the new build's `current-build.json` is committed: it exports the tree from git into the scratch folder, takes the new build's observation files out, seeds a scratch artifacts folder, runs steps 1, 3, 4 and 6 below and writes `drill-report.json` (`--plan` lists the commands without running them).

**1. Offline enumerators.** Each reads the game install, the pak scripts, the wiki export or the committed data, and writes `data/census/observations/<Enn>/<build>.jsonl`. Re-run E02 to E19; none launches Workbench. E01 is not re-run: it is the one-time Phase 0 import of the recon files (it also seeds `probes.jsonl`), and its rows stay on the build they were imported on (diff-builds counts them as not re-walked).

| Enumerator                              | Script                                                        |
| --------------------------------------- | ------------------------------------------------------------- |
| E01 recon import (one-time, not re-run) | `npx tsx scripts/census/enumerators/e01-recon-import.ts`      |
| E02 script source                       | `npx tsx scripts/census/enumerators/e02-script-source.ts`     |
| E03 plugin registry                     | `npx tsx scripts/census/enumerators/e03-plugin-registry.ts`   |
| E04 net surface                         | `npx tsx scripts/census/enumerators/e04-net-surface.ts`       |
| E05 executable tables                   | `npx tsx scripts/census/enumerators/e05-executable-tables.ts` |
| E06 settings store                      | `npx tsx scripts/census/enumerators/e06-settings-store.ts`    |
| E07 wiki tables                         | `npx tsx scripts/census/enumerators/e07-wiki-tables.ts`       |
| E08 shipped docs                        | `npx tsx scripts/census/enumerators/e08-shipped-docs.ts`      |
| E09 file types                          | `npx tsx scripts/census/enumerators/e09-file-types.ts`        |
| E10 data schema                         | `npx tsx scripts/census/enumerators/e10-data-schema.ts`       |
| E11 MCP inventory                       | `npx tsx scripts/census/enumerators/e11-mcp-inventory.ts`     |
| E12 API index                           | `npx tsx scripts/census/enumerators/e12-api-index.ts`         |
| E13 launch logs                         | `npx tsx scripts/census/enumerators/e13-launch-logs.ts`       |
| E14 diag menu                           | `npx tsx scripts/census/enumerators/e14-diag-menu.ts`         |
| E15 attribute scan                      | `npx tsx scripts/census/enumerators/e15-attribute-scan.ts`    |
| E16 property editors                    | `npx tsx scripts/census/enumerators/e16-property-editors.ts`  |
| E17 workbench data                      | `npx tsx scripts/census/enumerators/e17-workbench-data.ts`    |
| E18 tool gestures                       | `npx tsx scripts/census/enumerators/e18-tool-gestures.ts`     |
| E19 Blender operators                   | `npx tsx scripts/census/enumerators/e19-blender-operators.ts` |

Order matters where one reads another's output: E02 first (E04, E08, E12, E15, E16 and the diag catalog read its source index); E05 before E04 (E04's net-function rows record whether E05 named them; run in table order, E04 writes "named in the executable: unknown" on all seven) and before E06; E08 and E19 before E04 (its cross-check artifacts); E02 to E05 before E11 (its covers proposals); E17 before E15 (E15's shared-id report); E15 before E16 (E16 reads E15's usage file). One order that works: E02, E03, E05, E06, E07, E08, E19, E04, E09, E10, E11, E12, E13, E14, E17, E15, E16, E18. Run `npx tsx scripts/census/gen-diag-catalog.ts` after E02 to refresh `data/census/diag-catalog.json`. Each script's header lists its flags. All take `--data`, `--out`, `--build` and `--json`; the input flag differs: `--game` for E02, E03, E04, E09, E10, E12 (its comment scan only), E14, E15, E16 and E18; `--recon` for E01; `--exe` for E05; `--reg` for E06 (default: the export above); `--tools` for E04, E08 and E19; `--logs` for E13; `--repo` for E11; `--api-dir` for E12; `--wiki` for E09, E14 and E16 and `--export` for E07 (all default to `data/wiki/export.xml`). E17 takes no input flag: it reads the game and Tools paks from the configured install paths, and its `--artifacts` names where it writes its tables. With the defaults each input resolves from the repository that holds `--data`, so a plain run needs no input flag. The real 1.9.0.37 re-baseline (`449dcd6`) did not run E12, which is why `ledger.meta.json` still lists E12 as pending; the drill ran it (2,396 observations, exit 0).

**2. Live walkers (needs a running Workbench; owner-supervised).** `scripts/census/live/L01-snapshot.ts`, `L02-menus.ts`, `L03-chrome.ts`, `L04-dialogs.ts`, `L05-context.ts`, `L06-grids.ts`, `L07-screens.ts`, `L09-actions.ts`, `L10-modules.ts`, `L11-plugins.ts`, `L14-launcher.ts`, `L15-diag.ts` and `L17-qt.ts`. Run without `--really` a walker only writes its plan (`--out <plan.json>`); with `--really --id <lane> --sandbox <dir> --run-dir <dir>` it drives Workbench on the sandbox, so do that only in a live sitting. L01 also needs `--module <module>` and `--only <step>` with `--really`. Fold each run folder into the committed observation file with `npx --no tsx scripts/census/live/normalise.ts --enumerator L01 <run folder>` (add `--check` first to see the difference without writing). Until the live walks are redone, the build tag's carry-over entry stands in for them.

**3. Normalise and build.** `npx tsx scripts/census/build.ts` rebuilds the ledger shards from the observations (`--check` writes nothing and exits 1 on a difference). Then `npx tsx scripts/census/reconcile.ts` (universes and count gates) and `npx tsx scripts/census/validate.ts --all`.

What to expect. Run before the live walks are folded, build.ts writes the ledger but exits 1 with `problem <id>: state names a row that no observation produces (absent-in-build candidate)` for every row that state names and only a new-build walk produces (the drill: 237 lines, 236 of them Resource Manager rows and one a World Editor row, all first walked on 1.9.0.37); they clear once step 2's run folders are normalised. Do not dispose them as absent-in-build before the walk. reconcile.ts and validate.ts exit 1 on the committed 1.9.0.37 ledger already (reconcile: 22 open universes; validate: G2 FAIL, 17 issues), so the bar for a new build is "no new FAIL against the old build's run", not exit 0: run both on the old ledger first and compare. A count gate that fails because the build moved a count (on 1.9.0.37: 122 plugins, 43 NET handlers, `WorldEditorAPI` 125 methods) is fixed by updating that universe's `expected` value and its `source` in `data/census/universes.json`, with a decision entry, as `449dcd6` did. Tests that compare an enumerator with numbers recorded on one build skip on any other build until `RECORDED_BUILD` in `tests/census/_installed.ts` and their numbers are re-recorded.

**4. Diff the builds.** `npx tsx scripts/census/diff-builds.ts --from <old build> --to <new build>` (add `--json` for the full lists). It reports rows present on one build only, with the old-build-only rows split into removed and not re-walked (below), locator records added, removed or changed (`data/census/locators/<build>.jsonl`), observations added, removed or changed per enumerator, and the stale-T5 rows. When only the new build is checked out, take the old ledger from git into a directory and pass `--from-ledger <dir>`: for example `git worktree add <dir> <old commit>` then `--from-ledger <dir>/data/census`, where `<old commit>` is the parent of the commit that set `current-build.json` to the new build (`git log --format=%H -- data/census/current-build.json`; for 1.9.0.37 it is `5c25a9a`). A path to a single ledger `.jsonl` file also works; that side's locators and observations then come from `--data`. Differences are not errors (exit 0); 2 is usage, 3 is malformed input.

Read the diff in this order: rows removed (an enumerator that saw the row on the old build ran again on the new build in full and did not see it: removed surface, check that no MCP action or test cites them); rows not re-walked (none of the row's enumerators re-enumerated the new build: the one-time E01 recon import, an enumerator not run on the new build, or a live walker the to-side `ledger.meta.json` `carry_over` entry carries; the surface is unknown on the new build, not gone, so re-walk it before calling anything removed; the text output counts them by enumerator and names the enumerators with observations on the old build only); rows only on the new build (new surface: new T0 to T2 rows to classify); changed observations (a `quote` or `signature` change on a row at T3 or above is a contract change to re-test); changed or removed locators (a driven row on a locator that no longer resolves fails with LOCATOR_STALE until the module is re-walked and `scripts/census/locators-carry.ts` is run).

**5. Stale-T5 batteries.** build.ts earns T5 only from a live result on the current build and stamps it with that build (`src/census/tier.ts`), so a ledger rebuilt on a new build holds no carried T5 row. Since 2026-11-14 diff-builds lists them from the old side: its `staleT5` block counts the rows at T5 on `--from` that are not T5 on `--to` (with `--from-ledger` pointing at the old checkout from step 4). The same list, read-only and grouped the same way, comes from `npx tsx scripts/census/update-drill.ts stale-t5 --old <dir>/data/census --new data/census` (the old checkout from step 4; add `--json` for the row ids). It lists the old ledger's T5 rows that are not T5 on the new one, grouped by wave (`w1`, `w3`, ...) and battery (the `wN-NN-name` part of the evidence ref). For the next build after 1.9.0.37 that is 540 rows in 94 batteries over waves w1 to w9. Re-run each listed battery in a live sitting on the new build; a row that passes gets fresh T5 evidence on the new build through `npx tsx scripts/census/promote.ts <id> --evidence EV-...` (or `--batch`). A row that fails or whose battery is gone is demoted or dispositioned (`scripts/census/dispose.ts`), not left at T5. Rows under `(unnamed)` carry T5 evidence that names no battery: find its source in the row's `tier_evidence` first.

**6. Generate and report.** `npx tsx scripts/census/gen-kb.ts` rewrites `data/kb/census/` (`--check` to verify; with `--data` pointing elsewhere it still writes this checkout's `data/kb/census/` unless `--out` is given); `npx tsx scripts/census/report.ts` rewrites the census report (`--summary` prints the gate lines and the tier histogram). `npx tsx scripts/census/check-doc-citations.ts` checks that every ledger id and tool name README.md, this playbook and docs/WORKBENCH-OPERATIONS.md cite still exists (exit 1 names each one that does not). Finish with the full gate in step 6 of the checklist below.

## Checklist

1. `npm run scrape` → check `scrape-meta.json` + class-count delta
2. Re-probe GUID tables (`find_broken_refs` smoke + the files listed above)
3. Wiki refresh: `Special:Export` in a real browser → `data/wiki/export.xml` → `npx tsx scripts/parse-wiki-export.ts` (see § "Refresh the wiki knowledge base")
4. Live re-test the engine-side workaround list
5. Skim the official changelog for script-API renames; grep templates/KB for hits
6. `npm run build && npx vitest run --pool=forks --poolOptions.forks.singleFork`
7. `npx tsx scripts/count-inventory.ts` → paste the tool / prompt / resource / class / wiki-page / test counts into README.md (header line, `api_search` + `wiki_search` rows, Development section)
8. Census: follow "Census steps for a new build" above (enumerators, normalise and build, `diff-builds.ts`, stale-T5 batteries, `gen-kb.ts`, `report.ts`)
