# wb_anim

```text
Anim, Behavior, ProcAnim editors: engine check of a file; TXA tracks via TxaExporter.
Read:
txaProfiles: Export profiles (.apr) in the loaded addons
txaChannels: Channels of one profile
txaRead: Events and custom properties of a .txa
Mutating:
check: Open in its owning editor; errors read from the log
txaExport: New .txa from keys; register and rebuild
txaEdit: Edit events or properties of a .txa
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Handler contract | `contracts/EMCP_WB_Anim.json` (EMCP_WB_Anim) |
| Census KB page | [data/kb/census/tools/wb_anim.md](../../../data/kb/census/tools/wb_anim.md) |

## Actions (6)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `txaProfiles` | no | no | Export profiles (.apr) in the loaded addons Refuses: RESOURCE_NOT_FOUND with owner step OI-W4-1 in next while no .apr is in a loaded addon (DEC-067) | `addon` (string) |
| `txaChannels` | no | no | Channels of one profile Refuses: RESOURCE_NOT_FOUND with owner step OI-W4-1 in next while no .apr is in a loaded addon (DEC-067) | `profile`* (string) |
| `txaRead` | no | no | Events and custom properties of a .txa Refuses: RESOURCE_NOT_FOUND with owner step OI-W4-1 in next while no .apr is in a loaded addon (DEC-067) | `path`* (string), `hint` (string), `propNames` (array<string>), `cursor` (string), `limit` (int) |
| `check` | yes | no | Open in its owning editor; errors read from the log Refuses: MODAL_HAZARD until probe P-W4-14 (GATED): nothing is opened; MODULE_NOT_SUPPORTED outside the Anim, Behavior, ProcAnim editors | `path`* (string) |
| `txaExport` | yes | yes | New .txa from keys; register and rebuild Refuses: RESOURCE_NOT_FOUND with owner step OI-W4-1 in next while no .apr is in a loaded addon (DEC-067); an existing target is refused | `profile`* (string), `target`* (string), `source` (string), `frames`* (int), `fps`* (int), `channelCount`* (int), `keyData`* (array<string>), `diffData` (array<string>), `confirm` (bool) |
| `txaEdit` | yes | yes | Edit events or properties of a .txa Refuses: RESOURCE_NOT_FOUND with owner step OI-W4-1 in next while no .apr is in a loaded addon (DEC-067); confirm refuses UNPROVEN until P-W4-06 | `path`* (string), `op`* (string), `eventType` (string), `index` (int), `fields` (array<string>), `values` (array<string>), `propName` (string), `propValue` (string), `confirm` (bool) |

`*` marks a required parameter of that action.

## Input parameters (23)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `txaProfiles`, `txaChannels`, `txaRead`, `check`, `txaExport`, `txaEdit`. |
| `addon` | string | no | addon id; default every loaded addon |
| `profile` | string | no | $addon:path, path or profile name |
| `path` | string | no | .txa path, project-relative |
| `hint` | string | no | source file hint for TrackLoad |
| `propNames` | array<string> | no | custom properties to read |
| `cursor` | string | no | nextCursor of the previous page |
| `limit` | integer | no | events per page, default 50, max 200 |
| `target` | string | no | new .txa, project-relative |
| `source` | string | no | source file name kept in the track |
| `frames` | integer | no | keyframe count |
| `fps` | integer | no | frames per second |
| `channelCount` | integer | no | must equal the profile's count |
| `keyData` | array<string \| number \| boolean> | no | floats as strings (P-W4-04 layout) |
| `diffData` | array<string \| number \| boolean> | no | floats as strings |
| `confirm` | boolean | no | true writes; else a dry run |
| `op` | string | no | add\|edit\|erase\|setProp\|clearProps |
| `eventType` | string | no | generic\|audio\|weighted (op add) |
| `index` | integer | no | event index |
| `fields` | array<string \| number \| boolean> | no | event vars to set |
| `values` | array<string \| number \| boolean> | no | values, same order as fields |
| `propName` | string | no |  |
| `propValue` | string \| number \| boolean | no |  |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_anim.<action>`. A row that links several actions is counted under each (35 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `check` | 2 | T3 2 | `mcp:action/wb_anim.check`, `mcp:handler-action/EMCP_WB_Anim.check` |
| `txaChannels` | 5 | T3 5 | `api:TxaExporter.GetProfileChannelGenFn/2`, `api:TxaExporter.GetProfileChannelName/2`, `api:TxaExporter.GetProfileIndex/1` |
| `txaEdit` | 9 | T3 9 | `api:TxaExporter.TrackAddAudioEvent/0`, `api:TxaExporter.TrackAddGenericEvent/0`, `api:TxaExporter.TrackAddWeightedEvent/0` |
| `txaExport` | 7 | T3 7 | `api:TxaExporter.ErrCode/0`, `api:TxaExporter.ErrMsg/0`, `api:TxaExporter.TrackExport/0` |
| `txaProfiles` | 6 | T3 6 | `api:TxaExporter.GetNumProfiles/0`, `api:TxaExporter.GetProfileChannelCount/1`, `api:TxaExporter.GetProfileName/1` |
| `txaRead` | 6 | T3 6 | `api:TxaExporter.TrackGetCustomProperty/1`, `api:TxaExporter.TrackGetEvent/1`, `api:TxaExporter.TrackGetEventCount/0` |
