# wb_particle

```text
Preview a .ptc in the open World Editor world (ParticleEffectEntity); never opens the Particle Editor.
Read:
stats: Emitters, particles, state, time
param: Read a float EmitterParam
Mutating:
spawn: Place a .ptc effect; confirm
control: play, stop, pause, stopEmission, restart
simulate: Advance by seconds, max 60
setParam: Set or multiply a float param
remove: Delete an effect; confirm
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Handler contract | `contracts/EMCP_WB_Particle.json` (EMCP_WB_Particle) |
| Census KB page | [data/kb/census/tools/wb_particle.md](../../../data/kb/census/tools/wb_particle.md) |

## Actions (7)

| Action | Writes | Project only | Summary | Parameters |
| --- | --- | --- | --- | --- |
| `spawn` | yes | yes | Place a .ptc effect; confirm Refuses: NOT_IN_PROJECT (no project, or not the project's world); NO_WORLD; WRONG_MODE in prefab edit or play mode; RESOURCE_NOT_FOUND; INVALID_ARGUMENT | `effect`* (string), `coords` (string), `name` (string), `confirm` (bool) |
| `stats` | no | no | Emitters, particles, state, time Refuses: NO_WORLD; WRONG_MODE; ENTITY_NOT_FOUND; NOT_A_PARTICLE_EFFECT; NO_PARTICLES when GetParticles is null | `entity`* (string) |
| `control` | yes | no | play, stop, pause, stopEmission, restart Refuses: INVALID_ARGUMENT for an unknown op; NO_WORLD; WRONG_MODE; ENTITY_NOT_FOUND; NOT_A_PARTICLE_EFFECT; NO_PARTICLES for restart | `entity`* (string), `op`* (string) |
| `simulate` | yes | no | Advance by seconds, max 60 Refuses: INVALID_ARGUMENT for seconds outside (0, 60] or minFps outside (0, 240]; NO_WORLD; WRONG_MODE; ENTITY_NOT_FOUND; NOT_A_PARTICLE_EFFECT; NO_PARTICLES | `entity`* (string), `seconds`* (string), `minFps` (string) |
| `param` | no | no | Read a float EmitterParam Refuses: UNPROVEN if P-W5-08 kills GetParam; INVALID_ARGUMENT (not a float param, emitter out of range); ENTITY_NOT_FOUND; NOT_A_PARTICLE_EFFECT | `entity`* (string), `emitter`* (int), `param`* (string) |
| `setParam` | yes | no | Set or multiply a float param Refuses: INVALID_ARGUMENT (not a float param, CURRENT_TIME, emitter, \|value\| > 10000, multiplier outside 0..10); NOT_A_PARTICLE_EFFECT | `entity`* (string), `emitter`* (int), `param`* (string), `value`* (string), `multiply` (bool) |
| `remove` | yes | yes | Delete an effect; confirm Refuses: NOT_IN_PROJECT; NO_WORLD; WRONG_MODE; ENTITY_NOT_FOUND; NOT_A_PARTICLE_EFFECT | `entity`* (string), `confirm` (bool) |

`*` marks a required parameter of that action.

## Input parameters (13)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `spawn`, `stats`, `control`, `simulate`, `param`, `setParam`, `remove`. |
| `effect` | string | no | .ptc rel path or {GUID}path |
| `coords` | string | no | x y z as text; default 10 m ahead |
| `name` | string | no |  |
| `confirm` | boolean | no |  |
| `entity` | string | no | id:/name:/index: ref |
| `op` | string | no | play stop pause stopEmission restart |
| `seconds` | string \| number | no | float as text, max 60 |
| `minFps` | string \| number | no | float as text; multi-step |
| `emitter` | integer | no | index; -1 not allowed |
| `param` | string | no | float EmitterParam name |
| `value` | string \| number | no | float as text; a multiplier w/ multiply |
| `multiply` | boolean | no |  |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/wb_particle.<action>`. A row that links several actions is counted under each (14 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `control` | 2 | T5 2 | `mcp:action/wb_particle.control`, `mcp:handler-action/EMCP_WB_Particle.control` |
| `param` | 2 | T5 2 | `mcp:action/wb_particle.param`, `mcp:handler-action/EMCP_WB_Particle.param` |
| `remove` | 2 | T5 2 | `mcp:action/wb_particle.remove`, `mcp:handler-action/EMCP_WB_Particle.remove` |
| `setParam` | 2 | T5 2 | `mcp:action/wb_particle.setParam`, `mcp:handler-action/EMCP_WB_Particle.setParam` |
| `simulate` | 2 | T3 2 | `mcp:action/wb_particle.simulate`, `mcp:handler-action/EMCP_WB_Particle.simulate` |
| `spawn` | 2 | T5 2 | `mcp:action/wb_particle.spawn`, `mcp:handler-action/EMCP_WB_Particle.spawn` |
| `stats` | 2 | T5 2 | `mcp:action/wb_particle.stats`, `mcp:handler-action/EMCP_WB_Particle.stats` |
