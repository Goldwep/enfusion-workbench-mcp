# Census: NavmeshGeneratorMain

69 rows (6 aggregate excluded).

## What it is

Module NavmeshGeneratorMain: api 7, cli 8, diag 1, file 2, schema 5, ui 46. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- class NavmeshGeneratorMain (api:NavmeshGeneratorMain)
- class Navmesh custom links (api:class/Navmesh custom links): NavmeshCustomLinkComponent with link types (door, ladder, jump); presets
- file-type .nmn (file:.nmn): Binary file with single navmesh instance - see Navmesh Tutorial
- file-type Navmesh files config (file:file-type/Navmesh files config): .conf, root BaseNavmeshFilesConfig { NavmeshFile "{GUID}....nmn" } plus an override array for partial navmeshes; 16 vanilla configs in Configs/Navmesh
- module Navmesh Generator module window (ui:NavmeshGeneratorMain/module/Navmesh Generator module window): Standalone "Navmesh Generator" (also called "Navmesh Editor" in CLI docs)
- module NavmeshGeneratorMain (ui:NavmeshGeneratorMain/module/NavmeshGeneratorMain)
- panel Navmesh sub-tool: stats (ui:NavmeshGeneratorMain/panel/Navmesh sub-tool: stats): Generator statistics
- window Arma Reforger Workbench (ui:NavmeshGeneratorMain/window/Arma Reforger Workbench)

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| api | 6 | 1 | 0 | 0 | 0 | 0 | 7 |
| cli | 5 | 1 | 2 | 0 | 0 | 0 | 8 |
| diag | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| file | 1 | 0 | 1 | 0 | 0 | 0 | 2 |
| schema | 5 | 0 | 0 | 0 | 0 | 0 | 5 |
| ui | 32 | 2 | 12 | 0 | 0 | 0 | 46 |

## By kind

- class: 2
- cli-switch: 8
- control: 3
- diag-option: 1
- dialog: 9
- file-type: 2
- menu: 1
- method: 5
- module: 2
- panel: 1
- property: 5
- property-group: 7
- region: 2
- shortcut: 8
- tool: 12
- window: 1

## By risk

- mutating: 37
- safe: 32

## Rows by kind

### class (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:NavmeshGeneratorMain | T1/T2 | candidate: none-known | none |
| api:class/Navmesh custom links | T0/T2 | candidate: file-format, net-api-handler | none |

### cli-switch (8)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| cli:-autogenerate | T2/T5 | candidate: cli | [wb_cli_run.navmeshBake](../tools/wb_cli_run.md) drive, [wb_cli_run.navmeshGenerate](../tools/wb_cli_run.md) drive |
| cli:-gamesystem | T1/T5 | candidate: cli | none |
| cli:-lognavmeshgen | T2/T5 | candidate: cli | none |
| cli:cli-switch/CLI%2Fserver: -disableNavmeshStreaming [projects] | T0/T5 | candidate: cli, file-format | none |
| cli:cli-switch/CLI: -autogenerate | T0/T5 | candidate: cli | none |
| cli:cli-switch/CLI: -loadNavmesh | T0/T5 | candidate: cli | none |
| cli:cli-switch/CLI: -logNavmeshGen | T0/T5 | candidate: cli | none |
| cli:cli-switch/CLI: -saveDir | T0/T5 | candidate: cli | none |

### control (3)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:NavmeshGeneratorMain/control/#Maximize-Restore | T2/T5 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/control/#Minimize-Restore | T2/T5 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/control/Close | T2/T5 | candidate: gui-automation | none |

### diag-option (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| diag:diag-option/Diag menu: AI > Navmesh | T0/T2 | candidate: gui-automation, net-api-handler | none |

### dialog (9)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:NavmeshGeneratorMain/dialog/Dialog: Generator area | T0/T3 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/dialog/Dialog: Recast params | T0/T3 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/dialog/Navmesh sub-tool: query filter | T0/T3 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/dialog/nm::NavmeshGeneratorAreaDialog | T0/T3 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/dialog/nm::NavmeshGeneratorChangePolyDialog | T0/T3 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/dialog/nm::NavmeshGeneratorChooseFileDialog | T0/T3 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/dialog/nm::NavmeshGeneratorConnectDialog | T0/T3 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/dialog/nm::NavmeshGeneratorQueryFilterDialog | T0/T3 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/dialog/nm::NavmeshGeneratorRecastDialog | T0/T3 | candidate: gui-automation | none |

### file-type (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| file:.nmn | T2/T3 | candidate: file-format | [navmesh.header](../tools/navmesh.md) read, [navmesh.status](../tools/navmesh.md) read, [navmesh.tiles](../tools/navmesh.md) read |
| file:file-type/Navmesh files config | T0/T3 | candidate: file-format | none |

### menu (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:NavmeshGeneratorMain/menu/Navmesh Generator actions (8) | T0/T3 | candidate: execute-action | none |

### method (5)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| api:method/Config override for vanilla terrains | T0/T5 | candidate: file-format | none |
| api:method/Runtime: get navmesh component | T0/T5 | candidate: net-api-handler | none |
| api:method/Runtime: load tile | T0/T5 | candidate: net-api-handler | none |
| api:method/Runtime: request rebuild | T0/T5 | candidate: net-api-handler | none |
| api:method/Runtime: tile state | T0/T5 | candidate: net-api-handler | none |

### module (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:NavmeshGeneratorMain/module/Navmesh Generator module window | T1/T5 | candidate: cli, net-api-handler | none |
| ui:NavmeshGeneratorMain/module/NavmeshGeneratorMain | T1/T5 | candidate: builtin-net-handler, net-api-handler | none |

### panel (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:NavmeshGeneratorMain/panel/Navmesh sub-tool: stats | T0/T3 | candidate: gui-automation | none |

### property (5)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| schema:property/Entity flag OnFilteredNavmesh | T0/T2 | candidate: file-format, plugin-run | none |
| schema:property/Navmesh Tool: Autosave when done | T0/T2 | candidate: gui-automation | none |
| schema:property/Navmesh Tool: Navmesh selector | T0/T2 | candidate: gui-automation | none |
| schema:property/Navmesh Tool: Show | T0/T2 | candidate: gui-automation | none |
| schema:property/Navmesh Tool: Vertical Offset | T0/T2 | candidate: gui-automation | none |

### property-group (7)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:NavmeshGeneratorMain/property-group/AIWorld entity + NavmeshWorldComponent setup | T0/T3 | candidate: file-format, net-api-handler | none |
| ui:NavmeshGeneratorMain/property-group/Navmesh project settings in .gproj | T0/T3 | candidate: file-format, gui-automation | none |
| ui:NavmeshGeneratorMain/property-group/NavmeshWorldComponent: RecastConfig (NavmeshRecastConfig) | T0/T3 | candidate: file-format | none |
| ui:NavmeshGeneratorMain/property-group/NavmeshWorldComponent: Server Config | T0/T3 | candidate: file-format | none |
| ui:NavmeshGeneratorMain/property-group/NavmeshWorldComponent: WorldSettings (NavmeshWorldParams) | T0/T3 | candidate: file-format | none |
| ui:NavmeshGeneratorMain/property-group/Physics layer presets "...NoNavmesh" | T0/T3 | candidate: file-format | none |
| ui:NavmeshGeneratorMain/property-group/SCR_AIWorld navmesh-related entity properties | T0/T3 | candidate: file-format | none |

### region (2)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:NavmeshGeneratorMain/region/#SystemMenuBar | T0/T2 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/region/@TitleBar.1 | T0/T2 | candidate: gui-automation | none |

### shortcut (8)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:NavmeshGeneratorMain/shortcut/Navmesh Generator/Connect | T2/T2 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/shortcut/Navmesh Generator/Disconnect | T2/T2 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/shortcut/Navmesh Generator/Generate | T2/T2 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/shortcut/Navmesh Generator/Load | T2/T2 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/shortcut/Navmesh Generator/Load Project | T2/T2 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/shortcut/Navmesh Generator/Save | T2/T2 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/shortcut/Navmesh Generator/Save as | T2/T2 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/shortcut/Navmesh Generator/Stop Generation | T2/T2 | candidate: gui-automation | none |

### tool (12)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:NavmeshGeneratorMain/tool/Navmesh Tool: Connect | T0/T5 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/tool/Navmesh Tool: Disconnect | T0/T5 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/tool/Navmesh Tool: Generate | T0/T5 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/tool/Navmesh Tool: Load Navmesh | T0/T5 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/tool/Navmesh Tool: Rebuild tile | T0/T5 | candidate: gui-automation, net-api-handler | none |
| ui:NavmeshGeneratorMain/tool/Navmesh Tool: Save | T0/T5 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/tool/Navmesh Tool: Save As | T0/T5 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/tool/Navmesh Tool: Save Generated | T0/T5 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/tool/Navmesh Tool: Stop Generation | T0/T5 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/tool/Navmesh sub-tool: diff | T0/T5 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/tool/Navmesh sub-tool: path testing | T0/T5 | candidate: gui-automation | none |
| ui:NavmeshGeneratorMain/tool/World Editor toolbar: Navmesh Tool | T0/T5 | candidate: execute-action, gui-automation | none |

### window (1)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| ui:NavmeshGeneratorMain/window/Arma Reforger Workbench | T2/T3 | candidate: gui-automation | none |

## Below target (61)

- T0 to T2: 9
- T0 to T3: 19
- T0 to T5: 22
- T1 to T2: 1
- T1 to T5: 3
- T2 to T3: 2
- T2 to T5: 5

| id | tier | path |
| --- | --- | --- |
| api:NavmeshGeneratorMain | T1/T2 | candidate: none-known |
| api:class/Navmesh custom links | T0/T2 | candidate: file-format, net-api-handler |
| api:method/Config override for vanilla terrains | T0/T5 | candidate: file-format |
| api:method/Runtime: get navmesh component | T0/T5 | candidate: net-api-handler |
| api:method/Runtime: load tile | T0/T5 | candidate: net-api-handler |
| api:method/Runtime: request rebuild | T0/T5 | candidate: net-api-handler |
| api:method/Runtime: tile state | T0/T5 | candidate: net-api-handler |
| cli:-autogenerate | T2/T5 | candidate: cli |
| cli:-gamesystem | T1/T5 | candidate: cli |
| cli:-lognavmeshgen | T2/T5 | candidate: cli |
| cli:cli-switch/CLI%2Fserver: -disableNavmeshStreaming [projects] | T0/T5 | candidate: cli, file-format |
| cli:cli-switch/CLI: -autogenerate | T0/T5 | candidate: cli |
| cli:cli-switch/CLI: -loadNavmesh | T0/T5 | candidate: cli |
| cli:cli-switch/CLI: -logNavmeshGen | T0/T5 | candidate: cli |
| cli:cli-switch/CLI: -saveDir | T0/T5 | candidate: cli |
| diag:diag-option/Diag menu: AI > Navmesh | T0/T2 | candidate: gui-automation, net-api-handler |
| file:.nmn | T2/T3 | candidate: file-format |
| file:file-type/Navmesh files config | T0/T3 | candidate: file-format |
| schema:property/Entity flag OnFilteredNavmesh | T0/T2 | candidate: file-format, plugin-run |
| schema:property/Navmesh Tool: Autosave when done | T0/T2 | candidate: gui-automation |
| schema:property/Navmesh Tool: Navmesh selector | T0/T2 | candidate: gui-automation |
| schema:property/Navmesh Tool: Show | T0/T2 | candidate: gui-automation |
| schema:property/Navmesh Tool: Vertical Offset | T0/T2 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/control/#Maximize-Restore | T2/T5 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/control/#Minimize-Restore | T2/T5 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/control/Close | T2/T5 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/dialog/Dialog: Generator area | T0/T3 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/dialog/Dialog: Recast params | T0/T3 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/dialog/Navmesh sub-tool: query filter | T0/T3 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/dialog/nm::NavmeshGeneratorAreaDialog | T0/T3 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/dialog/nm::NavmeshGeneratorChangePolyDialog | T0/T3 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/dialog/nm::NavmeshGeneratorChooseFileDialog | T0/T3 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/dialog/nm::NavmeshGeneratorConnectDialog | T0/T3 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/dialog/nm::NavmeshGeneratorQueryFilterDialog | T0/T3 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/dialog/nm::NavmeshGeneratorRecastDialog | T0/T3 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/menu/Navmesh Generator actions (8) | T0/T3 | candidate: execute-action |
| ui:NavmeshGeneratorMain/module/Navmesh Generator module window | T1/T5 | candidate: cli, net-api-handler |
| ui:NavmeshGeneratorMain/module/NavmeshGeneratorMain | T1/T5 | candidate: builtin-net-handler, net-api-handler |
| ui:NavmeshGeneratorMain/panel/Navmesh sub-tool: stats | T0/T3 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/property-group/AIWorld entity + NavmeshWorldComponent setup | T0/T3 | candidate: file-format, net-api-handler |
| ui:NavmeshGeneratorMain/property-group/Navmesh project settings in .gproj | T0/T3 | candidate: file-format, gui-automation |
| ui:NavmeshGeneratorMain/property-group/NavmeshWorldComponent: RecastConfig (NavmeshRecastConfig) | T0/T3 | candidate: file-format |
| ui:NavmeshGeneratorMain/property-group/NavmeshWorldComponent: Server Config | T0/T3 | candidate: file-format |
| ui:NavmeshGeneratorMain/property-group/NavmeshWorldComponent: WorldSettings (NavmeshWorldParams) | T0/T3 | candidate: file-format |
| ui:NavmeshGeneratorMain/property-group/Physics layer presets "...NoNavmesh" | T0/T3 | candidate: file-format |
| ui:NavmeshGeneratorMain/property-group/SCR_AIWorld navmesh-related entity properties | T0/T3 | candidate: file-format |
| ui:NavmeshGeneratorMain/region/#SystemMenuBar | T0/T2 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/region/@TitleBar.1 | T0/T2 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/tool/Navmesh Tool: Connect | T0/T5 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/tool/Navmesh Tool: Disconnect | T0/T5 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/tool/Navmesh Tool: Generate | T0/T5 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/tool/Navmesh Tool: Load Navmesh | T0/T5 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/tool/Navmesh Tool: Rebuild tile | T0/T5 | candidate: gui-automation, net-api-handler |
| ui:NavmeshGeneratorMain/tool/Navmesh Tool: Save | T0/T5 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/tool/Navmesh Tool: Save As | T0/T5 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/tool/Navmesh Tool: Save Generated | T0/T5 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/tool/Navmesh Tool: Stop Generation | T0/T5 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/tool/Navmesh sub-tool: diff | T0/T5 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/tool/Navmesh sub-tool: path testing | T0/T5 | candidate: gui-automation |
| ui:NavmeshGeneratorMain/tool/World Editor toolbar: Navmesh Tool | T0/T5 | candidate: execute-action, gui-automation |

1 more: wb_census find with module=NavmeshGeneratorMain.

## Dispositions (14)

| id | kind | why | evidence |
| --- | --- | --- | --- |
| api:NavmeshGeneratorMain | absent-in-build | absent-in-build: class NavmeshGeneratorMain absent from the 1.9.0.37 E02 index; Page_CLI.html lists no NavmeshGeneratorMain (wb_cli_run.navmeshGeneratorPresence); session 019 -wbModule=NavmeshGeneratorMain opened a plain Workbench (proposal docs/v2/inbox/w5/remainder.jsonl; last seen 1.8.0.13; E02 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| api:class/Navmesh custom links | duplicate-of | G3 frontier: mirrors the recon_resolution duplicate-of already recorded under EV-s001-003 | EV-P4-exit-001 |
| cli:-autogenerate | blocked | blocked:P-W5-01 (CLI navmesh bake on 1.9: -autogenerate under -wbModule=WorldEditor on the tiny world); kill -> absent-in-build, bake re-points W8 Navmesh Tool (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-lognavmeshgen | blocked | blocked:P-W5-01 (CLI navmesh bake on 1.9: -autogenerate under -wbModule=WorldEditor on the tiny world); kill -> absent-in-build, bake re-points W8 Navmesh Tool; wiki: always on (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:cli-switch/CLI: -autogenerate | blocked | blocked:P-W5-01 (CLI navmesh bake on 1.9: -autogenerate under -wbModule=WorldEditor on the tiny world); kill -> absent-in-build, bake re-points W8 Navmesh Tool (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:cli-switch/CLI: -logNavmeshGen | blocked | blocked:P-W5-01 (CLI navmesh bake on 1.9: -autogenerate under -wbModule=WorldEditor on the tiny world); kill -> absent-in-build, bake re-points W8 Navmesh Tool; wiki: always on (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:cli-switch/CLI: -saveDir | blocked | blocked:P-W5-01 (CLI navmesh bake on 1.9: -autogenerate under -wbModule=WorldEditor on the tiny world); kill -> absent-in-build, bake re-points W8 Navmesh Tool (DEC-087 ruling 3) | EV-P6-BK2-003 |
| ui:NavmeshGeneratorMain/control/#Maximize-Restore | absent-in-build | absent-in-build: class NavmeshGeneratorMain absent from the 1.9.0.37 E02 index; Page_CLI.html lists no NavmeshGeneratorMain (wb_cli_run.navmeshGeneratorPresence); session 019 -wbModule=NavmeshGeneratorMain opened a plain Workbench (proposal docs/v2/inbox/w5/remainder.jsonl; last seen 1.8.0.13; L01 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| ui:NavmeshGeneratorMain/control/#Minimize-Restore | absent-in-build | absent-in-build: class NavmeshGeneratorMain absent from the 1.9.0.37 E02 index; Page_CLI.html lists no NavmeshGeneratorMain (wb_cli_run.navmeshGeneratorPresence); session 019 -wbModule=NavmeshGeneratorMain opened a plain Workbench (proposal docs/v2/inbox/w5/remainder.jsonl; last seen 1.8.0.13; L01 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| ui:NavmeshGeneratorMain/control/Close | absent-in-build | absent-in-build: class NavmeshGeneratorMain absent from the 1.9.0.37 E02 index; Page_CLI.html lists no NavmeshGeneratorMain (wb_cli_run.navmeshGeneratorPresence); session 019 -wbModule=NavmeshGeneratorMain opened a plain Workbench (proposal docs/v2/inbox/w5/remainder.jsonl; last seen 1.8.0.13; L01 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| ui:NavmeshGeneratorMain/region/#SystemMenuBar | absent-in-build | absent-in-build: class NavmeshGeneratorMain absent from the 1.9.0.37 E02 index; Page_CLI.html lists no NavmeshGeneratorMain (wb_cli_run.navmeshGeneratorPresence); session 019 -wbModule=NavmeshGeneratorMain opened a plain Workbench (proposal docs/v2/inbox/w5/remainder.jsonl; last seen 1.8.0.13; L01 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| ui:NavmeshGeneratorMain/region/@TitleBar.1 | absent-in-build | absent-in-build: class NavmeshGeneratorMain absent from the 1.9.0.37 E02 index; Page_CLI.html lists no NavmeshGeneratorMain (wb_cli_run.navmeshGeneratorPresence); session 019 -wbModule=NavmeshGeneratorMain opened a plain Workbench (proposal docs/v2/inbox/w5/remainder.jsonl; last seen 1.8.0.13; L01 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
| ui:NavmeshGeneratorMain/tool/Navmesh Tool: Generate | blocked | blocked:P-W5-01 (CLI navmesh bake on 1.9: -autogenerate under -wbModule=WorldEditor on the tiny world); kill -> absent-in-build, bake re-points W8 Navmesh Tool (DEC-087 ruling 3) | EV-P6-BK2-003 |
| ui:NavmeshGeneratorMain/window/Arma Reforger Workbench | absent-in-build | absent-in-build: class NavmeshGeneratorMain absent from the 1.9.0.37 E02 index; Page_CLI.html lists no NavmeshGeneratorMain (wb_cli_run.navmeshGeneratorPresence); session 019 -wbModule=NavmeshGeneratorMain opened a plain Workbench (proposal docs/v2/inbox/w5/remainder.jsonl; last seen 1.8.0.13; L01+L03+L07 ran on 1.9.0.37: data/census/observations/<E>/1.9.0.37.jsonl, row not observed) | EV-P6-BK1-001 |
