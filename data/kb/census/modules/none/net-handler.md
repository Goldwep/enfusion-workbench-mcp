# Census: no module, kind net-handler

20 rows (2 aggregate excluded).

## What it is

Module none: net 20. Seen in builds 1.8.0.13 to 1.9.0.37.

## By dimension and tier

| dim | T0 | T1 | T2 | T3 | T4 | T5 | total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| net | 0 | 0 | 18 | 2 | 0 | 0 | 20 |

## By kind

- net-handler: 20

## By risk

- mutating: 20

## Rows by kind

### net-handler (20)

| id | tier | path | tool actions |
| --- | --- | --- | --- |
| net:handler/AnimExportProfileChannels | T2/T5 | candidate: builtin-net-handler | [wb_bi.call](../../tools/wb_bi.md) read, [wb_bi.describe](../../tools/wb_bi.md) read, [wb_bi.list](../../tools/wb_bi.md) read |
| net:handler/AnimExportProfiles | T2/T5 | candidate: builtin-net-handler | [wb_bi.call](../../tools/wb_bi.md) read, [wb_bi.describe](../../tools/wb_bi.md) read, [wb_bi.list](../../tools/wb_bi.md) read |
| net:handler/AnimExportTrackExport | T2/T5 | candidate: builtin-net-handler | [wb_bi.describe](../../tools/wb_bi.md) read, [wb_bi.list](../../tools/wb_bi.md) read |
| net:handler/BakeInfo | T2/T5 | candidate: builtin-net-handler | [wb_bi.describe](../../tools/wb_bi.md) read, [wb_bi.list](../../tools/wb_bi.md) read |
| net:handler/CheckGUID | T2/T5 | candidate: builtin-net-handler | [wb_bi.call](../../tools/wb_bi.md) read, [wb_bi.describe](../../tools/wb_bi.md) read, [wb_bi.list](../../tools/wb_bi.md) read |
| net:handler/EBTInfo | T2/T5 | candidate: builtin-net-handler | [wb_bi.describe](../../tools/wb_bi.md) read, [wb_bi.list](../../tools/wb_bi.md) read |
| net:handler/ExampleCall | T2/T5 | candidate: builtin-net-handler | none |
| net:handler/FBXReportToolMessage | T2/T5 | candidate: builtin-net-handler | [wb_bi.describe](../../tools/wb_bi.md) read, [wb_bi.list](../../tools/wb_bi.md) read |
| net:handler/GetAnimationExporProfileChannelsInfo | T3/T5 | candidate: builtin-net-handler | [wb_bi.call](../../tools/wb_bi.md) drive |
| net:handler/GetAnimationExportProfileInfosInProject | T3/T5 | candidate: builtin-net-handler | [wb_bi.call](../../tools/wb_bi.md) drive |
| net:handler/GetGameMaterials | T2/T5 | candidate: builtin-net-handler | [wb_bi.call](../../tools/wb_bi.md) read, [wb_bi.describe](../../tools/wb_bi.md) read, [wb_bi.list](../../tools/wb_bi.md) read |
| net:handler/GetLayerInteraction | T2/T5 | candidate: builtin-net-handler | [wb_bi.describe](../../tools/wb_bi.md) read, [wb_bi.list](../../tools/wb_bi.md) read |
| net:handler/GetLoadedProjects | T2/T5 | candidate: builtin-net-handler | [wb_bi.call](../../tools/wb_bi.md) read, [wb_bi.describe](../../tools/wb_bi.md) read, [wb_bi.list](../../tools/wb_bi.md) read, [wb_projects.list](../../tools/wb_projects.md) read |
| net:handler/GetMaterialsByClass | T2/T5 | candidate: builtin-net-handler | none |
| net:handler/GetPathToAssetsFromGuids | T2/T5 | candidate: builtin-net-handler | [wb_bi.call](../../tools/wb_bi.md) read, [wb_bi.describe](../../tools/wb_bi.md) read, [wb_bi.list](../../tools/wb_bi.md) read |
| net:handler/GetResourceValidity | T2/T5 | candidate: builtin-net-handler | none |
| net:handler/LayerPresets | T2/T5 | candidate: builtin-net-handler | [wb_bi.describe](../../tools/wb_bi.md) read, [wb_bi.list](../../tools/wb_bi.md) read |
| net:handler/LoadedProjects | T2/T5 | candidate: builtin-net-handler | [wb_bi.call](../../tools/wb_bi.md) read, [wb_bi.describe](../../tools/wb_bi.md) read, [wb_bi.list](../../tools/wb_bi.md) read |
| net:handler/LocatePrefabsFromPath | T2/T5 | candidate: builtin-net-handler | [wb_bi.describe](../../tools/wb_bi.md) read, [wb_bi.list](../../tools/wb_bi.md) read, [wb_prefabs.locate](../../tools/wb_prefabs.md) read |
| net:handler/LocateProject | T2/T5 | candidate: builtin-net-handler | [wb_bi.call](../../tools/wb_bi.md) read, [wb_bi.describe](../../tools/wb_bi.md) read, [wb_bi.list](../../tools/wb_bi.md) read, [wb_prefabs.locate](../../tools/wb_prefabs.md) read, [wb_projects.locate](../../tools/wb_projects.md) read |

## Below target (20)

- T2 to T5: 18
- T3 to T5: 2

| id | tier | path |
| --- | --- | --- |
| net:handler/AnimExportProfileChannels | T2/T5 | candidate: builtin-net-handler |
| net:handler/AnimExportProfiles | T2/T5 | candidate: builtin-net-handler |
| net:handler/AnimExportTrackExport | T2/T5 | candidate: builtin-net-handler |
| net:handler/BakeInfo | T2/T5 | candidate: builtin-net-handler |
| net:handler/CheckGUID | T2/T5 | candidate: builtin-net-handler |
| net:handler/EBTInfo | T2/T5 | candidate: builtin-net-handler |
| net:handler/ExampleCall | T2/T5 | candidate: builtin-net-handler |
| net:handler/FBXReportToolMessage | T2/T5 | candidate: builtin-net-handler |
| net:handler/GetAnimationExporProfileChannelsInfo | T3/T5 | candidate: builtin-net-handler |
| net:handler/GetAnimationExportProfileInfosInProject | T3/T5 | candidate: builtin-net-handler |
| net:handler/GetGameMaterials | T2/T5 | candidate: builtin-net-handler |
| net:handler/GetLayerInteraction | T2/T5 | candidate: builtin-net-handler |
| net:handler/GetLoadedProjects | T2/T5 | candidate: builtin-net-handler |
| net:handler/GetMaterialsByClass | T2/T5 | candidate: builtin-net-handler |
| net:handler/GetPathToAssetsFromGuids | T2/T5 | candidate: builtin-net-handler |
| net:handler/GetResourceValidity | T2/T5 | candidate: builtin-net-handler |
| net:handler/LayerPresets | T2/T5 | candidate: builtin-net-handler |
| net:handler/LoadedProjects | T2/T5 | candidate: builtin-net-handler |
| net:handler/LocatePrefabsFromPath | T2/T5 | candidate: builtin-net-handler |
| net:handler/LocateProject | T2/T5 | candidate: builtin-net-handler |

## Dispositions (2)

| id | kind | why | evidence |
| --- | --- | --- | --- |
| net:handler/GetLayerInteraction | blocked | blocked:P-W6-11 (project-settings walk read, then VERIFIED_READ) [ledger work_item W2] (DEC-087 ruling 3) | EV-P6-BK2-003 |
| net:handler/LayerPresets | blocked | blocked:P-W6-11 (project-settings walk read, then VERIFIED_READ) [ledger work_item W2] (DEC-087 ruling 3) | EV-P6-BK2-003 |
