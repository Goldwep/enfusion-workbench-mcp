# Phase 3 tools (2.0 preview)

Pages for the tools Phase 3 added or rebuilt: `wb_scripts`, `wb_module`, `wb_container`,
`wb_plugin`, `wb_census`, `wb_cli_run` v2, and the aliases. Source of truth for each: the
contract in `contracts/` (per action), the tool file in `src/tools/`, and the decision entries
DEC-047 to DEC-050 of the 2.0 decision record. The per-tool pages generated from the census ledger
live in `data/kb/census/tools/`; this page links to them and does not copy them.

**Read this first.** This page was written at commit `eedcae1`, when none of the new Enforce handlers
(`EMCP_WB_Guard`, `EMCP_WB_BuildStamp`, `EMCP_WB_Info`, `EMCP_WB_Module`, `EMCP_WB_Container`,
`EMCP_WB_Plugin`) had compiled in Workbench (DEC-050). That changed on 2026-10-10: DEC-053 records the
first compile of the 28-file bundle (sitting P3-3, gates 1 and 2) and the live results in the
"Live status" table at the end. The "Unproven live" lines in the per-tool sections below are the
`eedcae1` text and were not re-audited against DEC-053 or the later waves; where they conflict, DEC-053
and the census-generated pages under `docs/tools/reference/` win.

## Shared vocabulary

Defined in sections 3 and 4 of the Phase 3 tool-surface design, enforced in
`src/manifest/vocabulary.ts`.

| Parameter                           | Form                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `module`                            | one of 10 ids (the Dialogue Editor is absent in this build, DEC-047 U8 read)           |
| `target`                            | one string: `path:<project-relative resource>` or `open:WorldEditor`                   |
| `path`                              | dotted with indices: `components[2].MeshObject.Object`                                 |
| `cursor`, `limit`, `fields`, `mode` | paging; `limit` default 100, max 200; `mode` is `summary` or `page`                    |
| `confirm`                           | literal `true`; without it only `wb_module save` and `wb_container set`/`save` dry-run |

Absolute paths and `..` are refused with `ABSOLUTE_PATH` before anything is sent (the absolute
form is what failed in DEC-047 U8 write).

Response shape for every new action: `{ ok, action, target, changed, readback, next?, warnings[] }`.
Error codes carry a default `next`: `MODULE_NOT_OPEN`, `NOT_IN_PROJECT`, `NOT_ALLOWLISTED`,
`ABSOLUTE_PATH`, `PATH_NOT_FOUND`, `MODAL_OPEN`, `LOST`, `INVALID_ARGUMENT`, `WEDGED`,
`UNREACHABLE`, `BUSY`, `VALIDATION_FAILED`, `RELOAD_FAILED`, `RUN_FAILED`, `GATED`,
`HANDLER_ERROR`, `MODULE_NOT_SUPPORTED`, `ENGINE_FALSE`, `UNPROVEN`, `SAVE_FAILED`.

Safety classes used below: **read** (changes nothing), **mutating** (changes Workbench or files),
**project only** (mutating, `projectOnly: true` in the contract, and the Enforce guard refuses unless the
handlers are installed in the open project and the target lies inside it, DEC-058; the TypeScript tools do
not make that check), **refusing** (present, answers `GATED` or `UNPROVEN`
and sends nothing), **prepare only** (builds a command line, never runs it).

## wb_scripts

Script compile train through Workbench's native functions. Tool file `src/tools/wb-scripts.ts`.
Generated page: [`wb_scripts`](../../data/kb/census/tools/wb_scripts.md).

| Action     | Safety   | Parameters                         | What it does                                                                                             |
| ---------- | -------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `status`   | read     | none                               | `IsWorkbenchRunning` (running, `ScriptsCompiled`) plus the Ping build stamp against this server's bundle |
| `validate` | read     | `configuration`: `WORKBENCH`, `PC` | `ValidateScripts`; errors, warnings, success                                                             |
| `reload`   | mutating | `scope`: only `scripts`            | `ReloadScripts`, then a re-ping; refused with `BUSY` while another call is pending                       |

Proven live (Phase 2): `ValidateScripts` answers Ok for `WORKBENCH` and `PC`, `HEADLESS` is
"unknown configuration", a planted syntax error is reported by file and line (DEC-047 U3, DEC-040).
`ReloadScripts` is Ok and the edited Ping handler came alive; a failed reload keeps the loaded
handlers (DEC-047 U4, DEC-040, DEC-044). `EvaluateScript` answers "Undefined API func" and is not
wrapped (DEC-047 U2).

Unproven live: the tool itself, the queue behaviour around it (`BUSY`, `LOST` on a reset, never
retried), and the build stamp comparison. They wait for sitting P3-2, the kernel battery
(DEC-048). Open from Phase 2: why the recovery reload after removing a bad file still answered
"Compilation failed" (DEC-047 U4 remainder), and a planted error producing false errors in the next
file (DEC-047 U3 remainder). A passing headless validate is not a handler compile gate (DEC-047 U14). Note: the Phase 3 tool-surface design (section 2) lists `validate` under mutating actions, while the tool sends it as a read call (`src/tools/wb-scripts.ts:334`); no decision entry records the reclassification.

## wb_module

Workbench modules, the 10 present ones. Tool file `src/tools/wb-module.ts`, contract
`contracts/EMCP_WB_Module.json`, handler `EMCP_WB_Module.c`.
Generated page: [`wb_module`](../../data/kb/census/tools/wb_module.md).

| Action        | Safety       | Parameters                        | What it does                                                           |
| ------------- | ------------ | --------------------------------- | ---------------------------------------------------------------------- |
| `list`        | read         | none                              | which modules are open; the Particle Editor is listed as unread        |
| `info`        | read         | `module`                          | one module: open state, container classes                              |
| `open`        | mutating     | `module`                          | `Workbench.OpenModule`                                                 |
| `front`       | mutating     | `module`                          | the native `BringModuleWindowToFront`; the handler itself refuses it   |
| `close`       | refusing     | `module`                          | always refused: no dirty-flag call is proven, the owner closes by hand |
| `setResource` | mutating     | `module`, `target` (`path:<rel>`) | World Editor only: open a resource                                     |
| `save`        | project only | `module`, `confirm`               | World Editor only: dry run unless `confirm: true`                      |
| `action`      | mutating     | `module`, `menuPath`, `keepFocus` | `ExecuteAction` on an allow-listed menu path only                      |

Proven live: `GetModule` is non-null for 10 of 11 modules, `OpenModule(DialogueEditor)` is false,
only the World Editor exposes a usable container, and the Particle Editor read crashed Workbench
(DEC-047 U8 read, DEC-042); that is why the Particle Editor is refused for every read. The World
Editor opens a resource through the shipped `openResource` with the project-relative form
(DEC-045, DEC-047 U8 write). Menu `ExecuteAction`: plain and lower-case `Window > Hierarchy`
toggled, the `&Window` form returned false (DEC-047 U9 and corrigendum 3). `Edit > Undo` undid one
created entity (DEC-047 U19).

Unproven live: the handler and every action as wrapped here; `setResource` on Audio and ProcAnim
(the project-relative retry waits for sitting P3-1, DEC-047 U8 write); a World Editor `save` through
this handler. `BringModuleWindowToFront` answers `{}` for every module name, the unknown one
included (DEC-040 sc-08, noted in `src/workbench/native.ts`), so its answer does not prove a window
moved.

## wb_container

One resource's BaseContainer. Tool file `src/tools/wb-container.ts`, contract
`contracts/EMCP_WB_Container.json`, handler `EMCP_WB_Container.c`.
Generated page: [`wb_container`](../../data/kb/census/tools/wb_container.md).

| Action                                                      | Safety                | Parameters                                    | What it does                                               |
| ----------------------------------------------------------- | --------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| `describe`                                                  | read                  | `target`, `mode`, `cursor`, `limit`, `fields` | summary by default, or a page; large walks spill to a file |
| `get`                                                       | read                  | `target`, `path`                              | one dotted path; a miss lists up to five sibling names     |
| `set`                                                       | project only          | `target`, `path`, `value`, `confirm`          | set a scalar and save; dry run unless `confirm: true`      |
| `save`                                                      | project only          | `target`, `confirm`                           | re-save; dry run unless `confirm: true`                    |
| `clear`, `arrayAdd`, `arrayRemove`, `arrayMove`, `setClass` | refusing (`UNPROVEN`) | as in the contract                            | present, send nothing; they wait for train #2 gate 2       |

Writes go anywhere inside the open project (DEC-058) and never to `open:WorldEditor`
(`UNPROVEN`; the World Editor is saved through `wb_module save`).

Proven live: all seven container extensions load by path (`.conf .emat .layout .agr .bt .ptc .acp`,
DEC-047 U16 read, DEC-042), and `BaseContainerTools.SaveContainer` wrote 10 of 10 files that loaded
back, with the project-relative path into an existing folder (DEC-047 U16 write, DEC-044). The
engine loads non-canonical text and `SaveContainer` canonicalises 6 of 7 types without
regenerating the `.pap` and `.siga` compiled blocks (DEC-047 U11), so `save` answers
`canonicalised: unknown`.

Unproven live: the handler; `BaseContainer.Set` through this tool (no live write ever set a
scalar through a container, DEC-047 U8 write is "could not be settled"); whether a failed save
leaves the changed value in memory. The five refusing actions are unproven by design.

## wb_plugin

Workbench plugins: catalog, presence, settings read. Tool file `src/tools/wb-plugin.ts`, contract
`contracts/EMCP_WB_Plugin.json`, handler `EMCP_WB_Plugin.c`.
Generated page: [`wb_plugin`](../../data/kb/census/tools/wb_plugin.md).

| Action               | Safety             | Parameters                               | What it does                                              |
| -------------------- | ------------------ | ---------------------------------------- | --------------------------------------------------------- |
| `list`               | read               | `module`, `cursor`, `limit`              | the catalog from the census ledger; no Workbench call     |
| `describe`           | read               | `module`, `className`                    | is the class present, does `GetPlugin` return an instance |
| `getSettings`        | read               | `module`, `className`, `cursor`, `limit` | the instance's variables, paged                           |
| `setSettings`        | write (`confirm`)  | `module`, `className`, `name`, `value`   | dry run unless `confirm`; with `confirm` refuses `NO_SETTER` |
| `run`                | write (`confirm`)  | `module`, `className`                    | `Run()` of a class on the run allow-list; else `NOT_ALLOWLISTED` |

Only the typenames in `data/census/policy.json` under `plugin_read_allow_list` resolve; anything
else is `NOT_ALLOWLISTED`. `RunCommandline` and `Configure` are never called.

Proven live: `GetPlugin` instance and attribute reads answered for three plugins; the call brought
the module window to the front for one of them, and the tool-instance probe for `SCR_CoordsTool`
returned false (DEC-047 U10, DEC-042). Three classes are on `plugin_run_allow_list` (DEC-103) and
were run live with no dialog and the sandbox unchanged: `CameraOrientationTool` (WorldEditor),
`SCR_LocLengthPlugin` (LocalizationEditor, needs an open string table) and
`SCR_CheckRuinModelsAndUsagePlugin` (ResourceManager). `run` refuses every other class with
`NOT_ALLOWLISTED`. Attribute writes stay refused (`NO_SETTER`).

## wb_census

Offline queries over the census ledger in `data/census`. Tool file `src/tools/wb-census.ts`.
Generated page: [`wb_census`](../../data/kb/census/tools/wb_census.md).

| Action        | Safety | What it does                                                               |
| ------------- | ------ | -------------------------------------------------------------------------- |
| `find`        | read   | search by name or id; filters `dim`, `kind`, `module`, `tier`              |
| `describe`    | read   | one row by id                                                              |
| `howto`       | read   | preferred path, tool and action, safety class, evidence; at most 600 chars |
| `status`      | read   | build and counts                                                           |
| `scanProject` | read   | walks a project folder in TypeScript and counts files against the ledger   |

Never contacts Workbench. `scanProject` is a plain filesystem walk because `FileIO.FindFiles`
raises a modal authorization prompt (DEC-047 U27, DEC-046). `howto` names a tool and action only
where the ledger row has an `mcp` link; the links were added from the E11 inventory (DEC-050). No
live dependency, so nothing here waits for a train.

## wb_cli_run (v2)

Curated Workbench command-line runner. Tool file `src/tools/wb-cli-run.ts`.
Generated page: [`wb_cli_run`](../../data/kb/census/tools/wb_cli_run.md).

| Verb                              | Safety       | Allow-listed now          | What it does                                               |
| --------------------------------- | ------------ | ------------------------- | ---------------------------------------------------------- |
| `openProject`                     | mutating     | yes                       | `-gproj` with `-exitAfterInit`; exits by itself            |
| `buildScripts`                    | mutating     | yes                       | `-gproj` with `-validate=<CFG>`; ended on its success line |
| `plugin`                          | mutating     | `AddonBuildInfoTool` only | `-plugin=<name>` and `-key=value` in one token each        |
| `navmeshGenerate`, `forceSaveAll` | mutating     | no                        | have an argv template, refused until measured              |
| `packAddon`, `publishAddon`       | prepare only | not needed                | prints the command line, never spawns                      |

The allow-list is data: `data/census/policy.json` under `cli_run.allow_list` and, for plugin
arguments, `cli_run.plugin_args`. A key outside the list, or one that is a Workbench switch, is
refused. The tool never passes `-clearSettings`, `-scriptAuthorizeAll` or the phantom
`-wbProjectPath`, and kills only its own child.

Proven live (Phase 2): `-gproj` opens the sandbox, `-exitAfterInit` exits with code 0,
`-validate=PC` reports success and then stays open so the harness ends it on that line, and
`-plugin=AddonBuildInfoTool` reads only `-addonPath=` in one token (DEC-047 U1, DEC-033 to DEC-037).
Unresolved: the `-buildData` form built nothing in either try (DEC-047 U1, L7), so `wb_build_data`
is still unmeasured. Unproven live: this v2 tool wrapper, which waits for the CLI battery in
sitting P3-2.

## Aliases

Old names routed to a new action. The router is `src/manifest/aliases.ts`. Aliases are listed only
under `ENFUSION_TOOLSET=all` (the registration switch applies since wave 3, DEC-051; see the README section).

| Alias                 | Routes to               | Wired at `eedcae1`                                                                                                                               |
| --------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `wb_validate_scripts` | `wb_scripts validate`   | yes, `src/tools/wb-validate-scripts.ts`                                                                                                          |
| `wb_reload`           | `wb_scripts reload`     | yes, `src/tools/wb-reload.ts`; the old `target` argument becomes `scope`                                                                         |
| `wb_open_resource`    | `wb_module setResource` | router entry only; the 1.x tool is registered separately, only under `ENFUSION_TOOLSET=all`                                                      |
| `wb_save`             | `wb_module save`        | router entry only; the 1.x tool is registered separately, only under `ENFUSION_TOOLSET=all`; a routed call would dry-run, `confirm: true` writes |

## Live status in one table

As of DEC-053 (2026-10-10, session 013). Later waves may have proven more; the census-generated pages under
`docs/tools/reference/` are the current record and were not re-read for this table.

| Tool           | Live result in DEC-053                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wb_scripts`   | not named as a tool run in DEC-053; the kernel battery proved a reload after a broken plant compiles and `Ping` answers (L1, U4)                               |
| `wb_module`    | L2 proven: `GetModule` opens a closed module; world create, open, `setResource` and save on the DEC-045 route; `setResource` and `save` stay World-Editor-only |
| `wb_container` | L2 proven: describe 939 rows; by-path write and save with confirm on a throwaway copy                                                                          |
| `wb_plugin`    | L3 reads proven on 3 plugins (describe, getSettings); the modal-plugin and `RunCommandline` refusals were not exercised live                                   |
| `wb_census`    | offline, tested (DEC-049)                                                                                                                                      |
| `wb_cli_run`   | L7 partial: `openProject` proven; `buildScripts` and `AddonBuildInfoTool` timed out at 300 s; `-buildData` idle-timed-out and is not on the allow-list         |

Source: DEC-053, "Phase 3 live results, per layer".
