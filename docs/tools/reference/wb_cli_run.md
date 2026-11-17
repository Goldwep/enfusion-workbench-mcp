# wb_cli_run

```text
Run an allow-listed Workbench command line (policy.json cli_run; else NOT_ALLOWLISTED, or GATED until its probe). Verbs: openProject, buildScripts, navmeshGenerate, forceSaveAll, navmeshBake, plugin; packAddon, publishAddon only prepared.
Mutating: spawns its own Workbench; paths stay in the project or artifacts folder; Resave plugins need confirm; never -forceSettings; kills only its own child.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/wb_cli_run.md](../../../data/kb/census/tools/wb_cli_run.md) |

## Input parameters (9)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `verb` | string | yes | openProject \| buildScripts \| navmeshGenerate \| forceSaveAll \| navmeshBake \| plugin \| packAddon \| publishAddon One of: `openProject`, `buildScripts`, `navmeshGenerate`, `forceSaveAll`, `navmeshBake`, `plugin`, `packAddon`, `publishAddon`. |
| `gproj` | string | yes | Path to the .gproj (must exist) |
| `target` | string | no | navmeshGenerate / forceSaveAll / navmeshBake: engine resource path (worlds/My.ent) or absolute; no '-' lead, no '..' |
| `save_dir` | string | no | navmeshBake: absolute -saveDir folder, inside the project or under the artifacts folder |
| `confirm` | boolean | no | ResavePlugin / ResaveMetaPlugin / SCR_TerrainEntityVariantReplacementPlugin: true runs (rewrites files); else a dry run |
| `configuration` | string | no | buildScripts: the -validate=<CFG> configuration Default: `"PC"`. |
| `plugin` | object | no | plugin verb: -plugin=<name> and its -key=value arguments |
| `timeout_seconds` | number | no | Wall-clock timeout, 10-1800 (default 100); navmeshBake always uses 600 Default: `100`. |
| `launcher_nudge` | boolean | no | Auto-confirm the launcher's project picker (Windows) Default: `true`. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_cli_run.<action>`. A row that links several actions is counted under each (29 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `buildScripts` | 3 | T2 2, T3 1 | `cli:-gproj`, `cli:-validate`, `mcp:action/wb_cli_run.buildScripts` |
| `forceSaveAll` | 6 | T2 5, T3 1 | `cli:-forcesaveall`, `cli:-gproj`, `cli:-load` |
| `navmeshBake` | 2 | T2 1, T3 1 | `cli:-autogenerate`, `mcp:action/wb_cli_run.navmeshBake` |
| `navmeshGenerate` | 5 | T2 4, T3 1 | `cli:-autogenerate`, `cli:-gproj`, `cli:-run` |
| `openProject` | 3 | T2 2, T3 1 | `cli:-exitafterinit`, `cli:-gproj`, `mcp:action/wb_cli_run.openProject` |
| `packAddon` | 4 | T2 3, T3 1 | `cli:-gproj`, `cli:-packaddon`, `cli:-wbmodule` |
| `plugin` | 3 | T2 2, T3 1 | `cli:-gproj`, `cli:-plugin`, `mcp:action/wb_cli_run.plugin` |
| `publishAddon` | 3 | T2 3 | `cli:-gproj`, `cli:-publishaddon`, `cli:-wbmodule` |
