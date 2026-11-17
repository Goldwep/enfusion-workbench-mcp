# wb_audio

```text
Audition sound in the World Editor world: play an .acp event, playSound, isPlaying, stop, audible; variable, setVariable, resetVariables; masters, setMaster, pause; outputStates (these need wb_world play); entityEvents, entityPlay, setSignal on an entity; soundMap; open a project .acp/.sig in the Audio Editor. Runtime only: nothing is saved.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Handler contract | `contracts/EMCP_WB_Audio.json` (EMCP_WB_Audio) |
| Census KB page | [data/kb/census/tools/wb_audio.md](../../../data/kb/census/tools/wb_audio.md) |

## Actions (17)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `play` | yes | no | .acp event Refuses: NO_WORLD; WRONG_MODE; RESOURCE_NOT_FOUND; INVALID_ARGUMENT; PLAY_FAILED (PlayEventInitialize false or invalid handle) | `resource`* (string), `eventName`* (string), `position` (string), `signals` (array<string>) |
| `playSound` | yes | no | Sample Refuses: NO_WORLD; WRONG_MODE; RESOURCE_NOT_FOUND; INVALID_ARGUMENT for a non-sample; PLAY_FAILED | `resource`* (string) |
| `isPlaying` | no | no | State Refuses: INVALID_ARGUMENT when handle is missing or negative | `handle`* (int) |
| `stop` | yes | no | Handle Refuses: INVALID_ARGUMENT: handle missing, fadeTime not 0 to 60 | `handle`* (int), `fadeTime` (string) |
| `audible` | no | no | Audibility Refuses: NO_WORLD; WRONG_MODE; RESOURCE_NOT_FOUND; INVALID_ARGUMENT | `resource`* (string), `eventName`* (string), `position` (string) |
| `variable` | no | no | Value Refuses: VARIABLE_NOT_FOUND when the id is below 0; RESOURCE_NOT_FOUND | `resource`* (string), `name`* (string) |
| `setVariable` | yes | no | Set variable Refuses: VARIABLE_NOT_FOUND; INVALID_ARGUMENT when value is not a float; ENGINE_FALSE | `resource`* (string), `name`* (string), `value`* (string) |
| `resetVariables` | yes | no | Reset all | none |
| `masters` | no | no | Volumes | none |
| `setMaster` | yes | no | One volume Refuses: INVALID_ARGUMENT: unknown master, value not 0 to max(1, current); ENGINE_FALSE | `master`* (string), `value`* (string) |
| `pause` | yes | no | Or resume Refuses: INVALID_ARGUMENT for an empty list or an unknown master name | `masters`* (array<string>), `resume` (bool) |
| `outputStates` | no | no | Mixer Refuses: RESOURCE_NOT_FOUND; INVALID_ARGUMENT for a non-.afm, or name without resource | `resource` (string), `name` (string) |
| `entityEvents` | no | no | Sound events Refuses: NO_WORLD; WRONG_MODE; ENTITY_NOT_FOUND; NO_SOUND_COMPONENT | `entity`* (string) |
| `entityPlay` | yes | no | Entity event Refuses: NO_WORLD; WRONG_MODE; ENTITY_NOT_FOUND; NO_SOUND_COMPONENT; EVENT_NOT_FOUND; PLAY_FAILED | `entity`* (string), `eventName`* (string) |
| `setSignal` | yes | no | Entity signal Refuses: NO_WORLD; WRONG_MODE; ENTITY_NOT_FOUND; NO_SIGNALS_MANAGER; an unknown name: index -1 | `entity`* (string), `name`* (string), `value`* (string) |
| `soundMap` | no | no | Map values Refuses: NO_WORLD; WRONG_MODE; NO_SOUND_WORLD when the world has no ChimeraWorld SoundWorld | `position` (string) |
| `open` | yes | yes | Audio Editor Refuses: NOT_IN_PROJECT; WRONG_MODULE unless OwnerOf names AudioEditor; GATED with confirm until P-W5-12 | `path`* (string), `confirm` (bool) |

`*` marks a required parameter of that action.

## Input parameters (15)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `play`, `playSound`, `isPlaying`, `stop`, `audible`, `variable`, `setVariable`, `resetVariables`, `masters`, `setMaster`, `pause`, `outputStates`, `entityEvents`, `entityPlay`, `setSignal`, `soundMap`, `open`. |
| `resource` | string | no | .acp by rel path or {GUID}path |
| `eventName` | string | no | event (Sound node) name |
| `position` | string \| array<number> | no | x y z as text; default camera |
| `signals` | array<string> \| object | no | name=value, value as text |
| `handle` | integer | no | from play, playSound or entityPlay |
| `fadeTime` | number \| string | no | seconds as text; empty: cut |
| `name` | string | no |  |
| `value` | number \| string | no | float as text |
| `master` | string | no | SFX Music VoiceChat Dialog UI |
| `masters` | array<string> | no | names; mask built in handler |
| `resume` | boolean | no |  |
| `entity` | string | no | id:/name:/index: ref |
| `path` | string | no | project-relative .acp or .sig |
| `confirm` | boolean | no |  |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_audio.<action>`. A row that links several actions is counted under each (34 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `audible` | 2 | T5 2 | `mcp:action/wb_audio.audible`, `mcp:handler-action/EMCP_WB_Audio.audible` |
| `entityEvents` | 2 | T3 2 | `mcp:action/wb_audio.entityEvents`, `mcp:handler-action/EMCP_WB_Audio.entityEvents` |
| `entityPlay` | 2 | T3 2 | `mcp:action/wb_audio.entityPlay`, `mcp:handler-action/EMCP_WB_Audio.entityPlay` |
| `isPlaying` | 2 | T5 2 | `mcp:action/wb_audio.isPlaying`, `mcp:handler-action/EMCP_WB_Audio.isPlaying` |
| `masters` | 2 | T5 2 | `mcp:action/wb_audio.masters`, `mcp:handler-action/EMCP_WB_Audio.masters` |
| `open` | 2 | T3 2 | `mcp:action/wb_audio.open`, `mcp:handler-action/EMCP_WB_Audio.open` |
| `outputStates` | 2 | T5 2 | `mcp:action/wb_audio.outputStates`, `mcp:handler-action/EMCP_WB_Audio.outputStates` |
| `pause` | 2 | T3 2 | `mcp:action/wb_audio.pause`, `mcp:handler-action/EMCP_WB_Audio.pause` |
| `play` | 2 | T5 2 | `mcp:action/wb_audio.play`, `mcp:handler-action/EMCP_WB_Audio.play` |
| `playSound` | 2 | T5 2 | `mcp:action/wb_audio.playSound`, `mcp:handler-action/EMCP_WB_Audio.playSound` |
| `resetVariables` | 2 | T3 2 | `mcp:action/wb_audio.resetVariables`, `mcp:handler-action/EMCP_WB_Audio.resetVariables` |
| `setMaster` | 2 | T5 2 | `mcp:action/wb_audio.setMaster`, `mcp:handler-action/EMCP_WB_Audio.setMaster` |
| `setSignal` | 2 | T3 2 | `mcp:action/wb_audio.setSignal`, `mcp:handler-action/EMCP_WB_Audio.setSignal` |
| `setVariable` | 2 | T5 2 | `mcp:action/wb_audio.setVariable`, `mcp:handler-action/EMCP_WB_Audio.setVariable` |
| `soundMap` | 2 | T3 2 | `mcp:action/wb_audio.soundMap`, `mcp:handler-action/EMCP_WB_Audio.soundMap` |
| `stop` | 2 | T5 2 | `mcp:action/wb_audio.stop`, `mcp:handler-action/EMCP_WB_Audio.stop` |
| `variable` | 2 | T5 2 | `mcp:action/wb_audio.variable`, `mcp:handler-action/EMCP_WB_Audio.variable` |
