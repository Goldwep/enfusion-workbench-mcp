# mod-dev: development-only probe packs

Two Workbench-side Enforce script packs for the 2.0 census (plan 5.4 item 7, Appendix A). They are
**development-only and never shipped**: the npm package ships `mod/` and not `mod-dev/`, the
registered server installs handlers only from `mod/Scripts/WorkbenchGame/EnfusionMCP/`, and
`tests/live-harness/probe-pack.test.ts` asserts both, plus that no file under `mod/` carries the
`ECEN_` prefix.

| Pack      | Folder               | Class and file prefix | NET API function | Installed for               |
| --------- | -------------------- | --------------------- | ---------------- | --------------------------- |
| Read-only | `mod-dev/probe/`     | `ECEN_Probe`          | `ECEN_Probe`     | train #1, session S-D       |
| Mutating  | `mod-dev/probe-mut/` | `ECEN_ProbeMut`       | `ECEN_ProbeMut`  | train #1b, session S-E only |

The packs share no file and no class. Each compiles beside the complete shipped handler set
without the other; neither is ever installed alone.

## Install (the harness only)

```
npx tsx scripts/live/launch.ts --install-handlers <sandbox> --probe-pack mod-dev/probe
npx tsx scripts/live/launch.ts --install-handlers <sandbox> --probe-pack mod-dev/probe --probe-pack mod-dev/probe-mut
```

The first line is train #1 (S-D); the second is train #1b (S-E), which names both packs when S-E
also reads with the read-only pack. Without `--really` and a held lease this is a dry run that
prints what it would copy and which files it would delete. With them it copies the shipped set into
`<sandbox>/Scripts/WorkbenchGame/EnfusionMCP/` and the packs' `ECEN_*.c` files into
`<sandbox>/Scripts/WorkbenchGame/EnfusionCensus/`, so that this folder holds exactly the `ECEN_*.c`
files of the packs named: every other `ECEN_*.c` file in it is deleted first, and the folder is
checked afterwards. `launch.ts` refuses a pack folder outside `mod-dev/`, a file without the
`ECEN_` prefix, two packs that hold a file of the same name, a pack without the shipped set already
installed, and any sandbox but the 2.0 sandbox (a folder named `EMCP2_sandbox`). Only `.c` files
are copied; this README and `contracts/` stay here.

The deletion is a deviation from plan 5.1, which says the install never deletes anything
(DEC-029). It is the one deletion the installer performs: files named `ECEN_*.c`, directly in
`EnfusionCensus/`, of the 2.0 sandbox. Other files there are left alone.

## Removal of the mutating pack (plan 5.4 item 7)

The sandbox's `.gitignore` hides `EnfusionCensus/` from the clean check, so the harness enforces
"installed only for the session that needs it" itself (DEC-029):

- **Pre-flight** (`scripts/live/preflight.ts`) refuses at step 7, and again at step 8, when
  `<sandbox>/Scripts/WorkbenchGame/EnfusionCensus/ECEN_ProbeMut*.c` is present and the session queue
  is not S-E's. The S-E queue names itself with `"session": "S-E"`.
- **S-E's post-flight** removes the pack: `postflight.ts ... --remove-probe-mut` deletes the
  `ECEN_ProbeMut*.c` files in that folder, only in the 2.0 sandbox and only once the Workbench this
  lane started is gone, then checks they are gone. Every other post-flight reports a pack still
  present as a failed step.
- **The next install** of the read-only pack deletes any `ECEN_ProbeMut*.c` left behind (above).

What the handlers themselves guarantee as well: every `ECEN_ProbeMut` action and every
`ECEN_Probe` action except `info` refuses unless the opened project is the 2.0 sandbox.

## Wire format

Request and response keys are in `contracts/<Function>.json` (the format `scripts/enforce-lint.ts
--contracts` reads). Every response carries `status` (`ok`, `error` or `refused`), `action`,
`message`, facts as two parallel string arrays `factKeys` / `factValues`, and a table as
`columns` plus `cells` (row-major, `columns.length` cells a row). The read-only pack pages tables
200 rows a page: `page` in the request (clamped to `[0, pageCount - 1]`), `total`, `page` and
`pageCount` in the response.

Paths leave both handlers through `ShowPath`: the sandbox folder becomes `<sandbox>` and every
`<drive>:/Users/<name>` (either slash style; any letter case in the read-only pack) becomes
`%USERPROFILE%`, so the raw NET response holds no account name. The harness rewrites with `toPlaceholders` again before it writes evidence, and
`scripts/live/netcall.ts` prints a decoded response only after `toPlaceholders` (the sandbox, the
Tools and game installs, the repository, %LOCALAPPDATA% and %USERPROFILE%).

Request keys differ from Appendix A's shorthand where Enforce or the engine forces it:
`class` is a keyword, so the key is `className`; no vanilla script uses `module` as an
identifier, so the key is `moduleName` rather than risk a reserved word in a compile train; a key
cannot be a string for one action and an array for another, so `executeAction` takes `menuPath`
(array) and `path` stays a string.

## Read-only pack `ECEN_Probe`

Every action except `info` refuses unless the opened project is the 2.0 sandbox
(`ECEN_ProbeUtil.SandboxDir`: the project file is `EMCP2_sandbox.gproj` in a folder named
`EMCP2_sandbox`, given as an absolute path).

| Action          | Request keys                                      | What it calls                                                                                                                                                                                            | Settles              |
| --------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `info`          | `page`                                            | `Workbench.GetCurrentGameProjectFile`, `GetExecutableFilePath`, `GetCwd`; `GameProject.GetLoadedAddons`, `GetAddonID`, `GetAddonTitle`, `IsVanillaAddon`. Fact `isSandbox`. Never the user name          | baseline; 5.3 step 9 |
| `moduleMatrix`  | `openModules`, `moduleName`, `page`               | per module of the eleven: `Workbench.GetModule`; `GetNumContainers`; per container `GetClassName` and variable names (`GetNumVars`, `GetVarName`). With `openModules`, `OpenModule` of `moduleName` only | U8                   |
| `containerDump` | `moduleName`, `index`, `depth`, `page`            | `GetContainer(index)` of an open module; per variable path, name, `DataVarType`, `GetDefaultAsString`, `IsVariableSet`, `IsVariableSetDirectly`, object class, UI widget; never a value                  | U8                   |
| `executeAction` | `moduleName`, `menuPath`, `keepFocus`, `candidate`| `WBModuleDef.ExecuteAction(menuPath, keepFocus)` on an open module, only for a path compiled into `ECEN_ProbeAllowList.c`                                                                                | U9                   |
| `getPlugin`     | `moduleName`, `className`                         | `GetPlugin(type)`: returned or null, instance class                                                                                                                                                      | U10                  |
| `pluginAttrs`   | `moduleName`, `className`, `page`                 | `GetPlugin`, then `typename` reflection: variable names, types, whether an `[Attribute]` annotates them, current values of int, float, bool, string, ResourceName and vector variables (`ShowPath`)      | U10                  |
| `toolInstance`  | `className`                                       | World Editor `GetPlugin(<WorldEditorTool type>)`, `WorldEditorAPI.GetCurrentToolName`                                                                                                                    | U10                  |
| `evalCompile`   | `text`                                            | `ScriptModule.CompileScript(Workbench.GetWBGameScriptModule(), text, ...)`, then `Call(null, "ECEN_Eval", false, result)`, only for a text the allow screen passes                                       | U5                   |
| `loadContainer` | `path`, `depth`, `page`                           | `BaseContainerTools.LoadContainer(path)`, dumped like `containerDump`; never saved; a world file (`.ent`) refused                                                                                        | U16 read half        |
| `layerRead`     | `subScene`, `page`                                | `GetCurrentSubScene`, `GetNumSubScenes`, `GetActiveSubsceneLayer`, `GetCurrentEntityLayerId`, `GetSubsceneLayerPath`, `GetSubsceneFolders`, `GetSubsceneLayerId`, `IsSubsceneLayerVisible`               | U17 read half        |
| `terrainFacts`  | `terrainIndex` (0 only)                           | `WorldEditor.GetTerrainBounds` first ("no terrain" when false), then `GetTerrainResolutionX/Y`, `GetTerrainTilesX/Y`, `GetTerrainUnitScale`                                                              | W1 input             |
| `diagRead`      | `diagMenu`, `diagEnum`, or `diagId` with `engine` | `DiagMenu.SelectMenuByName(diagMenu)`; `GetValue`, `GetBool`, `GetRangeValue` for a script option; `GetEngineValue`, `GetEngineRangeValue` for a listed engine option. Never a set                       | U34                  |
| `screenshot`    | `folder`, `path`                                  | `System.MakeScreenshot(<sandbox folder>/<folder>/<path>)`, `folder` under `_throwaway/`, `path` `<label>-<nonce>.bmp`, the file new                                                                      | U28                  |
| `modalTest`     | none                                              | `Workbench.Dialog("ECEN probe modal", ...)`: the one dialog this pack opens                                                                                                                              | U6, U27              |

Response keys of every action: `status`, `action`, `message`, `factKeys`, `factValues`, `columns`,
`cells`, `total`, `page`, `pageCount`.

What the engine takes, where Appendix A's shorthand differs, and the limits compiled in:

- **`moduleMatrix`**: `openModules` opens one module a call, the one `moduleName` names, so the
  queue can confirm each window before the next call (plan 5.3 "During"). Without `openModules`
  no module is opened.
- **`diagRead {path}`**: `DiagMenu` reads take an `int` id, not a path. A script option is named
  by `diagEnum`, a `SCR_DebugMenuID` value (resolved with `typename.StringToEnum` and checked back
  with `EnumToString`); a raw `diagId` for a script option is refused. An engine option
  (`engine: true`) is read by `diagId` only when that id is on the list compiled from
  `probe.diag_read_engine_ids` (empty today), because an id past the engine's table is not known
  to be safe. `SelectMenuByName` takes a menu name and returns nothing.
- **`screenshot {path}`**: `System.MakeScreenshot(string path)` writes a BMP and returns whether
  the file can be written. An absolute or `$filesystem:` path is used as given, a relative one
  lands under `$profile:`, an empty one under `$profile:ScreenShots/`. This action always passes
  an absolute path inside the 2.0 sandbox: `folder` is `_throwaway` or a folder under it (no `:`,
  no `..`), `path` a bare file name `<label>-<nonce>.bmp`, refused when `FileIO.FileExists` reports
  the file already. The harness names the file: a non-empty label, `-`, then a run nonce of at
  least six hex digits it generates for the run; the handler refuses a name without a `-<6+ hex>`
  suffix before `.bmp`. `FileIO.FileExists` outside the profile folder can raise "Script
  Authorization Required", and after a refused prompt it may answer false, so the never-overwrite
  guard rests on the nonce and keeps `FileExists` only as a second check.
- **`layerRead {subScene}`**: `-1` (the default) is the current sub-scene. After that substitution
  an index below 0 (no world loaded) or at or above `GetNumSubScenes()` is answered with status
  `error` and fact `error` before any per-sub-scene getter runs. `GetSubsceneLayerPath` is skipped,
  and `currentEntityLayerPath` is empty, when `GetCurrentEntityLayerId()` is below 0.
- **`terrainFacts {terrainIndex}`**: only terrain 0 is read (no getter reports how many terrains
  a world holds); any other index is an `error`. `GetTerrainBounds` runs first: when it returns
  false the answer is `ok` with `hasBounds` false and fact `terrain` = `none`, and no terrain getter
  is called.
- **`loadContainer {path}`**: a resource name ending in `.ent` (any case) is refused with status
  `error` and fact `error`: a world loads synchronously on the NET thread with no bound. The `path`
  fact goes through `ShowPath`.
- **`toolInstance`**: `GetPlugin(typename)` is declared to return a `WorkbenchPlugin`, and
  `WorldEditorTool` does not inherit `WorkbenchPlugin`; the action records what the call returns
  for a tool type. Bohemia calls it with a tool type for one reason only, and says so in
  `SCR_AutotestPlugin.FocusWorldEditor`: "getting plugin focuses the module window". `getPlugin`,
  `pluginAttrs` and `toolInstance` therefore bring their module window to the front.
- **`executeAction`**: refused unless the path equals an allow-list entry exactly, and refused
  even then when a segment holds a deny-list label as a run of words ("Delete Selected" holds
  "Delete") or a refused word (`save`, `close`, `rename`, `open`, `delete`, `publish`, ... the
  `MENU_DENY_WORDS` of the generator, compiled in as `DenyWords`). Labels are compared as the
  dry-run checker's `normalizeLabel` compares them (`&x` to `x`, trailing `...` or `…` removed,
  white space collapsed, lower case), then word by word.
  With `candidate: true` (DEC-100) the path must instead equal an entry of `Candidates`
  (policy `execute_action.candidates`, paths with no live result yet), which only this pack
  compiles; the shipped handlers never read it. Only W9 `--candidates` sends it.
- **`evalCompile`**: an allow screen (`ECEN_ProbeEval.Screen`), not a deny screen. The text must
  be exactly one function `string ECEN_Eval() { ... }` of at most 2000 characters, with no
  comment, no `#` line and no character outside ASCII letters, digits, white space, string
  literals and `( ) { } [ ] ; , . = < > ! + - * / & | %`. Every identifier must be a keyword of a
  short list (`string`, `int`, `if`, `return`, ...), a class of a short list (`Workbench`,
  `GameProject`, `WorldEditorAPI`, the eleven modules, ...), an upper-case constant, a local
  (lower-case first, not `while`, `for`, `foreach`, `new`, `delete`, `thread`, `class`, ...), or
  a method called on a receiver whose name is a getter (`Get`, `Is`, `Has`, `Can`, `Find`,
  `Count`, `Contains` + upper case) or one of a few string and cast methods. No identifier may
  hold `Save`, `Set`, `Run`, `Create`, `Delete`, `Configure`, `Insert`, `Duplicate` and the other
  substrings of `Banned()`. No free identifier stands before `(`, so the text cannot call a global
  function or recurse; no loop keyword is allowed; no member field is read or written. Residual
  risk: a getter with a side effect (`GetPlugin` focuses the module window) and script code a
  getter of a script class runs [unverified that every reachable getter is read-only]. The
  runbook still restricts what the main session sends. The test checks the rules against a
  TypeScript model of the screen built from the lists in the `.c` file; the Enforce code itself
  runs first in train #1.

## Mutating pack `ECEN_ProbeMut`

| Action                  | Request keys                                                                                             | What it calls                                                                                                                                                                                                    | Settles        |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `containerWriteTest`    | `moduleName`, `target`, `index`, `varName`, `value` (`moduleSave` is refused)                            | `SetOpenedResource(target)` in a module other than the World Editor, `GetContainer(index)`, `GetSourceAddons`, `BaseContainer.Get` / `Set` of one scalar variable, read back; never a module `Save()`            | U8 write half  |
| `saveContainer`         | `source`, `target`                                                                                       | `BaseContainerTools.LoadContainer(source)`, `SaveContainer(container, "", <absolute target>)`                                                                                                                    | U16 write half |
| `pluginRunDialogFree`   | `moduleName`, `className`, `target`                                                                      | `GetPlugin(type).Run()` for a compiled-in module and class; never `RunCommandline`, never `Configure`                                                                                                            | U10            |
| `layerCreateThrowaway`  | `target`, `subScene`, `name`, `parentPath`, `setActive`, `save`                                          | `CreateSubsceneLayer`, optional `SetActiveSubsceneLayer`, `GetSubsceneFolders` read back; `WorldEditor.Save()` only with `save` and only for a new item                                                          | U17 write half |
| `terrainWriteThrowaway` | `target`, `mode`, `terrainIndex`, `tileX`, `tileY`, `sample`, `delta`, `x`, `z`, `size`, `inner`, `save` | `tile`: `GetTerrainSurfaceTile`, `SetTerrainSurfaceTile` inside `BeginTerrainAction(name)` / `EndTerrainAction`; `modify`: fails by name from build 1.9.0.37 on (`ModifyHeightMap`, `TerrainToolDesc`, `TerrainToolType` and the `FilterMorph` enums were removed; `BeginTerrainAction` lost its tool-type argument) | U18            |
| `diagSet`               | `diagEnum` or `diagId` with `engine`, `diagValue`                                                        | `DiagMenu.SetValue` or `SetEngineValue` on a compiled-in option, value read before and after                                                                                                                     | U34            |
| `createSandboxWorlds`   | `target`, `tinyName`, `terrainName`, `terrainEntities`                                                   | `SCR_WorldFilesHelper.CreateWorld` twice, overwrite flags false                                                                                                                                                  | OA-3 fallback  |

Response keys of every action: `status`, `action`, `message`, `factKeys`, `factValues`, `columns`,
`cells`.

### Guards compiled into the handler

These are in the handler (`ECEN_ProbeMutGuard.c` and the actions), not promises of the harness:

1. **Sandbox open.** Every action refuses unless the file name of
   `Workbench.GetCurrentGameProjectFile()` is `EMCP2_sandbox.gproj`, its folder is named
   `EMCP2_sandbox`, and that folder is an absolute path.
2. **Target inside the project.** Every action that writes a file takes an explicit `target`. It
   is a project-relative path (forward or back slashes; no `:`, no leading slash, no empty, `.` or
   `..` segment) that must resolve inside the project's folder, and for every action except
   `createSandboxWorlds` inside its `_throwaway/` folder. `createSandboxWorlds` takes the
   addon-prefixed folder `CreateWorld` itself takes (`$<filesystem>:<path>`) and checks it with the
   same `Workbench.GetAbsolutePath` call `CreateWorld` makes.
3. **The open world is the target, alone.** `layerCreateThrowaway`, `terrainWriteThrowaway` and
   `pluginRunDialogFree` on the World Editor check that `WorldEditorAPI.GetWorldPath` resolves to
   the target, an `.ent` under `_throwaway/`, and that the world has exactly one sub-scene (no
   parent world, whose layers and terrain lie outside `_throwaway/`), before they write. No
   action switches the World Editor's world: `containerWriteTest` refuses `WorldEditor`.
4. **Layers.** `layerCreateThrowaway` works only in the world's own sub-scene (`subScene` -1 or
   `GetCurrentSubScene()`), takes a `parentPath` that is empty or an item `GetSubsceneFolders`
   returned, and saves only when `CreateSubsceneLayer` returned a new item of that sub-scene (no
   `:`, no `..`). The returned value is a layer-tree item path, not a file path [form unverified].
5. **Terrain.** A write runs only after `BeginTerrainAction` returned true, so it never lands
   outside an undo point and `EndTerrainAction` is never called unpaired. A tile sample changes by
   at most 10 m; a `modify` brush is at most 50 m with `inner` in `[0, 100]`.
6. **Containers.** `containerWriteTest` writes only a container whose `GetSourceAddons` lists the
   sandbox (`EMCP2_sandbox`) and nothing else, so a module or editor settings container, which
   the Workbench writes back at exit, or a document of another addon is never written. The write
   stays in memory: `moduleSave` is refused because `WBModuleDef.Save()` takes no file argument and
   nothing shows which document it saves until the U8 read half has run. `saveContainer` is the
   persistence test, with an explicit target, in the vanilla form `SaveContainer(cont, "",
absPath)` (`ResourceInfo.c`, `BakeMLOD.c`).
7. **Compiled-in lists.** `pluginRunDialogFree` runs only a module and class listed in
   `ECEN_ProbeMutLists.c`; `diagSet` changes only an option listed there. Both lists are generated
   and empty today, so both actions refuse everything.
8. **World files.** World names are identifiers; existing world files are never overwritten;
   every `terrainEntities` entry must be `{` + 16 hex digits + `}` + a path of ASCII letters,
   digits, `_`, `-`, `.`, `/` and space (no quote, backslash or control character can reach the
   kept `default.layer`). A missing list is treated as empty.

No action calls `Workbench.Exit`, `RunCmd`, `RunProcess`, `RunCommandline`, `GetUserName`, a save
outside `_throwaway/` (`createSandboxWorlds` writes new world files in the sandbox and overwrites
none), or any opener or commit of plan Appendix B. The test's forbidden-symbol scan checks the
names, and its guard tests check the order of each guard before the call it protects.

### Side effects to declare in the S-D and S-E queues

- `moduleMatrix` with `openModules` opens one module window (reversible).
- `getPlugin`, `pluginAttrs` and `toolInstance` focus their module window.
- `diagRead` with `diagMenu` changes the diag menu selection.
- `screenshot` writes one new BMP under `_throwaway/`.
- `modalTest` blocks the NET call until the dialog is closed: detached caller, long timeout,
  owner present.
- `containerWriteTest` and `pluginRunDialogFree` (modules other than the World Editor) switch
  that module's current document with `SetOpenedResource`. No getter reports an unsaved document,
  and a module holding one may prompt [unverified]: the queue keeps every module clean before the
  call.

## Generated files

`mod-dev/probe/ECEN_ProbeAllowList.c` and `mod-dev/probe-mut/ECEN_ProbeMutLists.c` are generated
from `data/census/policy.json` and must not be edited by hand:

```
npx tsx scripts/live/gen-probe-allowlist.ts          # write both files
npx tsx scripts/live/gen-probe-allowlist.ts --check  # exit 1 when either differs from the policy
```

- `execute_action.candidates` (DEC-100): menu paths with no live result yet, compiled into
  `ECEN_ProbeAllowList.Candidates` only and run only with `candidate: true`. A candidate on the
  allow-list, or an entry on `execute_action.dialog_openers` (a live run saw it open a dialog), is
  refused by the generator.
- `execute_action.allow_list`: the menu paths `executeAction` may run. An entry is an array of
  segments (or a string split as the dry-run checker splits it, `A > B` or `A/B`). The handler
  matches exactly on every segment: no prefix, no case folding. The generator refuses a segment
  that holds a deny-list label (`execute_action.deny_list_seed` and every `deny_lists.*.labels`)
  as a run of words, holds a word of `MENU_DENY_WORDS`, or matches a credential or external
  risk-name rule of `row_defaults.risk_name_rules` for menu items; the handler refuses the first
  two again at run time. Entries today: `["Edit", "Undo"]`, for U19 on the sandbox's tiny world
  only (moved to S-E by DEC-040; S-D never sends it; label unverified, DEC-029), and S-D's U9 dock
  toggles `["Window", "Hierarchy"]` and `["Window", "Log Console"]` with their mnemonic (`&Window`)
  and lower-case forms listed as entries of their own, because the handler matches exactly and the
  generator derives no variant. Labels unverified; a wrong label returns false, which is data.
- `probe.diag_read_engine_ids` (entries `{ id, ledger_row }`, `id` an integer in
  `[0, 1000000]`): the engine diag options `diagRead` may read. In the policy since DEC-029, empty.
- `probe_mut.plugin_run_allow_list` (entries `{ module, class, ledger_row, evidence }`) and
  `probe_mut.diag_set_allow_list` (entries `{ key, ledger_row }`, key `script:<SCR_DebugMenuID
value>` or `engine:<int id>`). In the policy since DEC-029, both empty: both lists compile empty.
  A plugin class that matches a credential or external risk-name rule of the policy is refused.

The generated text is never rewritten to placeholders: a policy entry holding a home path or
another value of the placeholder table makes generation fail, because a rewrite would silently
change a compiled string literal.

## Checks before a train

```
npx tsx scripts/enforce-lint.ts mod-dev/probe --contracts mod-dev/contracts
npx tsx scripts/enforce-lint.ts mod-dev/probe-mut --contracts mod-dev/contracts
npx vitest run tests/live-harness/probe-pack.test.ts --pool=forks --poolOptions.forks.singleFork
```

Plan 5.4: a `.c` file here is frozen until its compile gate passes. Train #1 and #1b confirm with
the compile log, `ScriptsCompiled` and a probe `info` call. Before train #1 the Enforce reviewer,
the finder and the refuter read the packs again (plan 5.4 step 2, DEC-029): the fix pass of the
preparation was not reviewed again.

The probes the packs serve that need an action outside Appendix A are listed in DEC-029 by id. The
first three dialog-free plugins proposed for `pluginRunDialogFree` (`SCR_SnapAndOrientToTerrainPlugin`,
`SCR_CopyClassAndMethodPlugin`, `SCR_DebugLinePlugin`) are not on `probe_mut.plugin_run_allow_list`.
