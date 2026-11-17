# Census: no module, kind file-type

35 rows (0 aggregate excluded).

## What it is

Module none: file 35. Seen in builds 1.8.0.13 to 1.9.0.37.

Surfaces:

- file-type .adeb (file:.adeb): Binary stream format
- file-type .aex (file:.aex): 4 files in the 1.9.0.37 paks; text
- file-type .bak (file:.bak): 0 files in the 1.9.0.37 paks; unsampled; in the Workbench profile listing as .projectList_app1874880_user<steamid>.conf.bak-<date>, .projectList_app1874910_user<steamid>.conf.bak-<date>
- file-type .bak-2026-10-02-s-a (file:.bak-2026-10-02-s-a): 0 files in the 1.9.0.37 paks; unsampled; in the Workbench profile listing as <name>.bak-2026-10-02-s-a
- file-type .bin (file:.bin): 0 files in the 1.9.0.37 paks; unsampled; in the Workbench profile listing as DbgUIState.bin
- file-type .cso (file:.cso): 427 files in the 1.9.0.37 paks; binary
- file-type .dds (file:.dds): Source image format - other formats are also supported like png, jpeg, tiff, tga, hdr
- file-type .ettf (file:.ettf): 1 file in the 1.9.0.37 paks; binary
- file-type .fbx (file:.fbx): .txo and .xob source format
- file-type .ini (file:.ini): 0 files in the 1.9.0.37 paks; unsampled; in the Workbench profile listing as wbSettingsDump.ini
- file-type .json (file:.json): 1 file in the 1.9.0.37 paks; text; in the Workbench profile listing as <name>.json
- file-type .log (file:.log): 0 files in the 1.9.0.37 paks; unsampled; in the Workbench profile listing as CrashReports.log, console.log, error.log, script.log
- ... 23 more

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| file | 9 | 0 | 26 | 0 | 0 | 0 | 35 |

## By kind

- file-type: 35

## By risk

- safe: 35

## Rows by kind

### file-type (35)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| file:.adeb | T2/T3 | candidate: file-format | none |
| file:.aex | T2/T3 | candidate: file-format | none |
| file:.bak | T2/T3 | candidate: file-format | none |
| file:.bak-2026-10-02-s-a | T2/T3 | candidate: file-format | none |
| file:.bin | T2/T3 | candidate: file-format | none |
| file:.cso | T2/T3 | candidate: file-format | none |
| file:.dds | T2/T3 | candidate: file-format | none |
| file:.ettf | T2/T3 | candidate: file-format | none |
| file:.fbx | T2/T3 | candidate: file-format | [asset_orphan_scan.run](../../tools/asset_orphan_scan.md) read |
| file:.ini | T2/T3 | candidate: file-format | [wb_settings.diff](../../tools/wb_settings.md) read, [wb_settings.get](../../tools/wb_settings.md) read, [wb_settings.list](../../tools/wb_settings.md) read, [wb_settings.profile](../../tools/wb_settings.md) drive, [wb_settings.set](../../tools/wb_settings.md) drive, [wb_settings.stores](../../tools/wb_settings.md) read, [wb_settings.unset](../../tools/wb_settings.md) drive |
| file:.json | T2/T3 | candidate: file-format | [server_config.run](../../tools/server_config.md) read, [server_mod_list.run](../../tools/server_mod_list.md) read, [server_validate_config.run](../../tools/server_validate_config.md) read |
| file:.log | T2/T3 | candidate: file-format | [logs_filter.run](../../tools/logs_filter.md) read, [logs_list.run](../../tools/logs_list.md) read, [logs_summarize_errors.run](../../tools/logs_summarize_errors.md) read, [logs_tail.run](../../tools/logs_tail.md) read |
| file:.ntile | T2/T3 | candidate: file-format | [navmesh.header](../../tools/navmesh.md) read |
| file:.pak | T2/T3 | candidate: file-format | [asset_search.run](../../tools/asset_search.md) read, [game_browse.run](../../tools/game_browse.md) read, [game_read.run](../../tools/game_read.md) read |
| file:.pre | T2/T3 | candidate: file-format | none |
| file:.pso | T2/T3 | candidate: file-format | none |
| file:.rdb | T2/T3 | candidate: file-format | none |
| file:.smd | T2/T3 | candidate: file-format | none |
| file:.stars | T2/T3 | candidate: file-format | none |
| file:.ttf | T2/T3 | candidate: file-format | none |
| file:.txo | T2/T3 | candidate: file-format | none |
| file:.txt | T2/T3 | candidate: file-format | none |
| file:.vso | T2/T3 | candidate: file-format | none |
| file:.wav | T2/T3 | candidate: file-format | [asset_orphan_scan.run](../../tools/asset_orphan_scan.md) read |
| file:.wst | T2/T3 | candidate: file-format | none |
| file:.xob | T2/T3 | candidate: file-format | [asset_search.run](../../tools/asset_search.md) read, [building_setup.run](../../tools/building_setup.md) read |
| file:file-type/Launcher project list | T0/T3 | candidate: file-format | none |
| file:file-type/Profile file: profile%2F.projectList_app<appid>_user<steamid>.conf | T0/T3 | candidate: file-format | none |
| file:file-type/Profile file: profile%2F.save%2Fapp<id>_user<id>%2Fsettings%2FReforgerEngineSettings.conf + ReforgerGameSettings.conf | T0/T3 | candidate: file-format | none |
| file:file-type/Profile file: profile%2F.save%2Fsettings%2FcustomInputConfigs%2F | T0/T3 | candidate: file-format | none |
| file:file-type/Profile file: profile%2FDbgUIState.bin | T0/T3 | candidate: file-format | none |
| file:file-type/Profile file: profile%2FresourceDatabase.rdb + logs%2F<session>%2F{console,script,error}.log | T0/T3 | candidate: file-format | none |
| file:file-type/Profile file: profile%2FwbSettingsDump.ini | T0/T3 | candidate: cli, file-format | none |
| file:file-type/Session logs | T0/T3 | candidate: file-format | none |
| file:file-type/Workbench config data | T0/T3 | candidate: file-format | none |

## Below target (35)

- T0 to T3: 9
- T2 to T3: 26

| id | tier | path |
| --- | --- | --- |
| file:.adeb | T2/T3 | candidate: file-format |
| file:.aex | T2/T3 | candidate: file-format |
| file:.bak | T2/T3 | candidate: file-format |
| file:.bak-2026-10-02-s-a | T2/T3 | candidate: file-format |
| file:.bin | T2/T3 | candidate: file-format |
| file:.cso | T2/T3 | candidate: file-format |
| file:.dds | T2/T3 | candidate: file-format |
| file:.ettf | T2/T3 | candidate: file-format |
| file:.fbx | T2/T3 | candidate: file-format |
| file:.ini | T2/T3 | candidate: file-format |
| file:.json | T2/T3 | candidate: file-format |
| file:.log | T2/T3 | candidate: file-format |
| file:.ntile | T2/T3 | candidate: file-format |
| file:.pak | T2/T3 | candidate: file-format |
| file:.pre | T2/T3 | candidate: file-format |
| file:.pso | T2/T3 | candidate: file-format |
| file:.rdb | T2/T3 | candidate: file-format |
| file:.smd | T2/T3 | candidate: file-format |
| file:.stars | T2/T3 | candidate: file-format |
| file:.ttf | T2/T3 | candidate: file-format |
| file:.txo | T2/T3 | candidate: file-format |
| file:.txt | T2/T3 | candidate: file-format |
| file:.vso | T2/T3 | candidate: file-format |
| file:.wav | T2/T3 | candidate: file-format |
| file:.wst | T2/T3 | candidate: file-format |
| file:.xob | T2/T3 | candidate: file-format |
| file:file-type/Launcher project list | T0/T3 | candidate: file-format |
| file:file-type/Profile file: profile%2F.projectList_app<appid>_user<steamid>.conf | T0/T3 | candidate: file-format |
| file:file-type/Profile file: profile%2F.save%2Fapp<id>_user<id>%2Fsettings%2FReforgerEngineSettings.conf + ReforgerGameSettings.conf | T0/T3 | candidate: file-format |
| file:file-type/Profile file: profile%2F.save%2Fsettings%2FcustomInputConfigs%2F | T0/T3 | candidate: file-format |
| file:file-type/Profile file: profile%2FDbgUIState.bin | T0/T3 | candidate: file-format |
| file:file-type/Profile file: profile%2FresourceDatabase.rdb + logs%2F<session>%2F{console,script,error}.log | T0/T3 | candidate: file-format |
| file:file-type/Profile file: profile%2FwbSettingsDump.ini | T0/T3 | candidate: cli, file-format |
| file:file-type/Session logs | T0/T3 | candidate: file-format |
| file:file-type/Workbench config data | T0/T3 | candidate: file-format |

## Dispositions (0)

No row of this module carries a disposition.
