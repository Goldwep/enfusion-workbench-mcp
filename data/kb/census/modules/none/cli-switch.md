# Census: no module, kind cli-switch

172 rows (9 aggregate excluded).

## What it is

Module none: cli 172. Seen in builds 1.8.0.13 to 1.9.0.37.

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cli | 44 | 98 | 28 | 2 | 0 | 0 | 172 |

## By kind

- cli-switch: 172

## By risk

- credential: 2
- destructive: 1
- external: 1
- mutating: 168

## Rows by kind

### cli-switch (172)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| cli:-a2sipaddress | T1/T5 | candidate: cli | none |
| cli:-a2sport | T1/T5 | candidate: cli | none |
| cli:-activeailimit | T1/T5 | candidate: cli | none |
| cli:-addondownloaddir | T1/T5 | candidate: cli | none |
| cli:-addons | T1/T5 | candidate: cli | none |
| cli:-addonsdir | T2/T5 | candidate: cli | none |
| cli:-addonsdownloadpool | T1/T5 | candidate: cli | none |
| cli:-addonsrepair | T1/T5 | candidate: cli | none |
| cli:-addonsverify | T1/T5 | candidate: cli | none |
| cli:-addontempdir | T1/T5 | candidate: cli | none |
| cli:-agones | T1/T5 | candidate: cli | none |
| cli:-agonesalwaysallocated | T1/T5 | candidate: cli | none |
| cli:-ailimit | T1/T5 | candidate: cli | none |
| cli:-aipartialsim | T1/T5 | candidate: cli | none |
| cli:-animdebugger | T1/T5 | candidate: cli | none |
| cli:-autodeployfaction | T1/T5 | candidate: cli | none |
| cli:-autodeployloadout | T1/T5 | candidate: cli | none |
| cli:-autoreload | T1/T5 | candidate: cli | none |
| cli:-autoshutdown | T1/T5 | candidate: cli | none |
| cli:-autotest | T1/T5 | candidate: cli | none |
| cli:-backenddisablestorage | T1/T5 | candidate: cli | none |
| cli:-backendfreshsession | T1/T5 | candidate: cli | none |
| cli:-backendlocalstorage | T1/T5 | candidate: cli | none |
| cli:-bindip | T1/T5 | candidate: cli | none |
| cli:-bindport | T1/T5 | candidate: cli | none |
| cli:-cfg | T2/T5 | candidate: cli | none |
| cli:-checkinstance | T2/T5 | candidate: cli | none |
| cli:-clearsettings | T2/T2 | candidate: cli | none |
| cli:-client | T1/T5 | candidate: cli | none |
| cli:-config | T2/T5 | candidate: cli | [server_launch.run](../../tools/server_launch.md) drive |
| cli:-configuration | T1/T5 | candidate: cli | none |
| cli:-createdb | T1/T5 | candidate: cli | none |
| cli:-debugger | T1/T5 | candidate: cli | none |
| cli:-debuggerport | T1/T5 | candidate: cli | none |
| cli:-diagmenu | T1/T5 | candidate: cli | none |
| cli:-disableai | T1/T5 | candidate: cli | none |
| cli:-disablecrashreport | T1/T5 | candidate: cli | none |
| cli:-disablecrashreporter | T1/T5 | candidate: cli | none |
| cli:-disablenavmeshstreaming | T1/T5 | candidate: cli | none |
| cli:-disableshadersbuild | T1/T5 | candidate: cli | none |

132 more: wb_census find with module=none kind=cli-switch.

## Below target (171)

- T0 to T2: 3
- T0 to T5: 41
- T1 to T5: 98
- T2 to T5: 27
- T3 to T5: 2

| id | tier | path |
| --- | --- | --- |
| cli:-a2sipaddress | T1/T5 | candidate: cli |
| cli:-a2sport | T1/T5 | candidate: cli |
| cli:-activeailimit | T1/T5 | candidate: cli |
| cli:-addondownloaddir | T1/T5 | candidate: cli |
| cli:-addons | T1/T5 | candidate: cli |
| cli:-addonsdir | T2/T5 | candidate: cli |
| cli:-addonsdownloadpool | T1/T5 | candidate: cli |
| cli:-addonsrepair | T1/T5 | candidate: cli |
| cli:-addonsverify | T1/T5 | candidate: cli |
| cli:-addontempdir | T1/T5 | candidate: cli |
| cli:-agones | T1/T5 | candidate: cli |
| cli:-agonesalwaysallocated | T1/T5 | candidate: cli |
| cli:-ailimit | T1/T5 | candidate: cli |
| cli:-aipartialsim | T1/T5 | candidate: cli |
| cli:-animdebugger | T1/T5 | candidate: cli |
| cli:-autodeployfaction | T1/T5 | candidate: cli |
| cli:-autodeployloadout | T1/T5 | candidate: cli |
| cli:-autoreload | T1/T5 | candidate: cli |
| cli:-autoshutdown | T1/T5 | candidate: cli |
| cli:-autotest | T1/T5 | candidate: cli |
| cli:-backenddisablestorage | T1/T5 | candidate: cli |
| cli:-backendfreshsession | T1/T5 | candidate: cli |
| cli:-backendlocalstorage | T1/T5 | candidate: cli |
| cli:-bindip | T1/T5 | candidate: cli |
| cli:-bindport | T1/T5 | candidate: cli |
| cli:-cfg | T2/T5 | candidate: cli |
| cli:-checkinstance | T2/T5 | candidate: cli |
| cli:-client | T1/T5 | candidate: cli |
| cli:-config | T2/T5 | candidate: cli |
| cli:-configuration | T1/T5 | candidate: cli |
| cli:-createdb | T1/T5 | candidate: cli |
| cli:-debugger | T1/T5 | candidate: cli |
| cli:-debuggerport | T1/T5 | candidate: cli |
| cli:-diagmenu | T1/T5 | candidate: cli |
| cli:-disableai | T1/T5 | candidate: cli |
| cli:-disablecrashreport | T1/T5 | candidate: cli |
| cli:-disablecrashreporter | T1/T5 | candidate: cli |
| cli:-disablenavmeshstreaming | T1/T5 | candidate: cli |
| cli:-disableshadersbuild | T1/T5 | candidate: cli |
| cli:-enablenightgrain | T1/T5 | candidate: cli |
| cli:-enablewarp | T1/T5 | candidate: cli |
| cli:-exitafterinit | T2/T5 | candidate: cli |
| cli:-forcesettings | T3/T5 | candidate: cli |
| cli:-forceupdate | T2/T5 | candidate: cli |
| cli:-freezecheck | T1/T5 | candidate: cli |
| cli:-freezecheckmode | T1/T5 | candidate: cli |
| cli:-generateelectricity | T2/T5 | candidate: cli |
| cli:-generateshaders | T1/T5 | candidate: cli |
| cli:-gproj | T2/T5 | candidate: cli |
| cli:-gprojconfig | T1/T5 | candidate: cli |
| cli:-gpuadapter | T1/T5 | candidate: cli |
| cli:-gpudevice | T2/T5 | candidate: cli |
| cli:-jobsyslongworkercount | T1/T5 | candidate: cli |
| cli:-jobsysshortworkercount | T1/T5 | candidate: cli |
| cli:-keepcrashfiles | T1/T5 | candidate: cli |
| cli:-keepnumoflogs | T1/T5 | candidate: cli |
| cli:-keepsessionsave | T1/T5 | candidate: cli |
| cli:-language | T1/T5 | candidate: cli |
| cli:-link | T2/T5 | candidate: cli |
| cli:-listscenarios | T1/T5 | candidate: cli |

111 more: wb_census find with module=none.

## Dispositions (24)

| id | kind | why | evidence |
| --- | --- | --- | --- |
| cli:-addons | blocked | blocked:P-W6-09 (Workbench launch switch; wb_launch pass-through, W6) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-addonsdir | blocked | blocked:P-W6-09 (Workbench launch switch; wb_launch pass-through, W6) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-animdebugger | blocked | blocked:P-W8-13 (debugger targets, U40; a debugger attach is an external process) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-checkinstance | blocked | blocked:P-W6-09 (Workbench launch switch; wb_launch pass-through, W6) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-clearsettings | excluded-policy | DEC-056 ruling 15: risk destructive (plan 1.4): documented and walked read-only, never committed by a tool; the owner signs the exclusion | EV-P4-exit-002 |
| cli:-debugger | blocked | blocked:P-W8-13 (debugger targets, U40; a debugger attach is an external process) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-debuggerport | blocked | blocked:P-W8-13 (debugger targets, U40; a debugger attach is an external process) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-forceupdate | blocked | blocked:P-W6-09 (Workbench launch switch; wb_launch pass-through, W6) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-gprojconfig | blocked | blocked:P-W6-09 (Workbench launch switch; wb_launch pass-through, W6) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-language | blocked | blocked:P-W6-09 (Workbench launch switch; wb_launch pass-through, W6) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-load | blocked | blocked:P-W6-09 (Workbench launch switch; wb_launch pass-through, W6) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-minidump | blocked | blocked:P-W6-09 (Workbench launch switch; wb_launch pass-through, W6) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-nogamescriptsoninit | blocked | blocked:P-W6-09 (Workbench launch switch; wb_launch pass-through, W6) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-noopenlastresource | blocked | blocked:P-W6-09 (Workbench launch switch; wb_launch passes no extra switches today) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-nothrow | blocked | blocked:P-W6-09 (Workbench launch switch; wb_launch pass-through, W6) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-run | blocked | blocked:P-W6-09 (Workbench launch switch; wb_launch pass-through, W6) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-scrdefine | blocked | blocked:P-W6-09 (Workbench launch switch; wb_launch pass-through, W6) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-scrnoinline | blocked | blocked:P-W6-09 (Workbench launch switch; wb_launch pass-through, W6) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-silentcrashreport | blocked | blocked:P-W6-09 (Workbench launch switch; wb_launch pass-through, W6) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-vmerrormode | blocked | blocked:P-W6-09 (Workbench launch switch; wb_launch pass-through, W6) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-wbmodule | blocked | blocked:P-W6-09 (Workbench launch switch; wb_launch pass-through, W6) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-wbrun | blocked | blocked:P-W6-09 (Workbench launch switch; wb_launch passes no extra switches today) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-wbsilent | blocked | blocked:P-W6-09 (Workbench launch switch; wb_launch pass-through, W6) (DEC-087 ruling 3) | EV-P6-BK2-003 |
| cli:-worldsystemsconfig | blocked | blocked:P-W6-09 (Workbench launch switch; wb_launch pass-through, W6) (DEC-087 ruling 3) | EV-P6-BK2-003 |
