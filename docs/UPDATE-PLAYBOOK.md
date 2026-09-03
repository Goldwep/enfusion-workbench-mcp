# Game-update playbook

What to do when Bohemia ships an Arma Reforger / Arma Reforger Tools update. Written after absorbing the 1.6 → 1.7 (`stable_1_87_80`) update, which broke the API scraper in two ways and re-GUID'd base content. The pattern generalizes.

## The two mechanical refresh steps

### 1. Re-scrape the API index

```bash
npm run scrape
```

Reads the Doxygen zips from `ENFUSION_WORKBENCH_PATH` and rebuilds `data/api/`. Check `data/api/scrape-meta.json` afterward — it records when/where the scrape ran and the detected Jenkins build branch (e.g. `stable_1_87_80`), so staleness is detectable without diffing a 47 MB JSON.

Failure modes already survived once (and now guarded, but verify the guards held):

- **Zip layout changes.** The 1_87_80 build moved the Doxygen HTML under an extra `html/` directory; an unguarded scraper parses 0 classes *silently*. `resolvePrefix()` auto-detects the layout — if a future build restructures again, the scrape log will show `0 classes` and `writeClassesPreserving` will refuse to blank the existing data.
- **A source zip disappearing.** BI consolidated the standalone Enfusion zip into the combined Arma zip. The writer preserves prior data on an empty scrape rather than destroying it; a genuinely intended removal requires deleting the JSON by hand.
- **Pak container generation change.** 1.8 (HEAD version 3) changed two things inside `.pak` files at once: entry offsets became **absolute** file positions (previously DATA-relative) and compressed payloads gained a **zlib wrapper** (previously raw deflate). Symptom: every `game_read`/`asset_search` on packed content failing with zlib "invalid block type" / "invalid stored block lengths". The VFS now version-hints from HEAD, sniffs the RFC-1950 header per entry, verifies decompressed length, and locks the verified mode per pak — both generations are supported, so a future flip back won't break either. If a future update fails again with both interpretations exhausted, hex-dump one entry's first bytes (zstd magic `28 B5 2F FD`, LZ4 `04 22 4D 18`) before touching the reader.
- **Zips replaced by unpacked directories.** The 1.8 Tools build stopped shipping zips entirely: the docs now live at `Workbench/docs/ArmaReforgerScriptAPIPublic/` and `Workbench/docs/EnfusionScriptAPI/` (note the Enfusion rename — no "Public" suffix — and that the standalone Enfusion API returned after 1.7 consolidated it). `resolveDocsSource()` probes zip-then-directory, so both layouts work; `scrape-meta.json` records which `kind` was used.

After a successful scrape, compare class counts against the previous `scrape-meta.json` era — a large *drop* is a red flag; growth is normal.

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
3. Paste the title list into the big textarea. To also pick up **new** pages, type `Arma Reforger/Modding` into *Add pages from category* and click **Add** — note this adds only direct members, so repeat for any subcategories you care about (browse [Category:Arma Reforger/Modding](https://community.bistudio.com/wiki/Category:Arma_Reforger/Modding) to see them; the parser skips category/template pages, so over-including is harmless).
4. Check *Include only the current revision*, leave *Include templates* unchecked, check *Save as file*, and click **Export**.
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

## Checklist

1. `npm run scrape` → check `scrape-meta.json` + class-count delta
2. Re-probe GUID tables (`find_broken_refs` smoke + the files listed above)
3. Wiki refresh: `Special:Export` in a real browser → `data/wiki/export.xml` → `npx tsx scripts/parse-wiki-export.ts` (see § "Refresh the wiki knowledge base")
4. Live re-test the engine-side workaround list
5. Skim the official changelog for script-API renames; grep templates/KB for hits
6. `npm run build && npx vitest run --pool=forks --poolOptions.forks.singleFork`
7. `npx tsx scripts/count-inventory.ts` → paste the tool / prompt / resource / class / wiki-page / test counts into README.md (header line, `api_search` + `wiki_search` rows, Development section)
