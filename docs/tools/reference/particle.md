# particle

```text
Offline .ptc particle effects (EffectDef and its emitters); vanilla pak paths readable. Read: inspect, emitters, emitter, curves, refs, validate, diff, catalog. Write, project files only, dry run unless confirm: set, setCurve, addEmitter, cloneEmitter, copyEmitter, renameEmitter, removeEmitter, moveEmitter, create. Preview in a world with wb_particle.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/particle.md](../../../data/kb/census/tools/particle.md) |

## Actions (17)

`inspect`, `emitters`, `emitter`, `curves`, `refs`, `validate`, `diff`, `catalog`, `set`, `setCurve`, `addEmitter`, `cloneEmitter`, `copyEmitter`, `renameEmitter`, `removeEmitter`, `moveEmitter`, `create`

## Input parameters (19)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `inspect`, `emitters`, `emitter`, `curves`, `refs`, `validate`, `diff`, `catalog`, `set`, `setCurve`, `addEmitter`, `cloneEmitter`, `copyEmitter`, `renameEmitter`, `removeEmitter`, `moveEmitter`, `create`. |
| `path` | string | no | The .ptc: project-relative, absolute inside the project, or (reads) a game path. Not for catalog. |
| `projectPath` | string | no | Addon root. Uses the configured project when omitted. |
| `emitter` | string | no | Emitter name (the source for cloneEmitter/copyEmitter). |
| `index` | integer | no | Emitter position, instead of emitter. |
| `props` | object | no | set/addEmitter/create: Key to value ({GUID}path text for Material/Prefab, 3 numbers for vectors, 0/1 flags). No emitter on set means the effect itself. |
| `unset` | array<string> | no | set: keys to remove. |
| `curve` | string | no | setCurve/curves: curve block name (Alpha, Size, Color ...). |
| `points` | array<number> | no | setCurve: flat numbers, time value pairs (time r g b for colour curves), times 0..1 rising. Empty removes the curve. |
| `name` | string | no | addEmitter/cloneEmitter/copyEmitter/renameEmitter: emitter name; create: first emitter. |
| `at` | integer | no | addEmitter/cloneEmitter/copyEmitter/moveEmitter: position. |
| `from` | string | no | copyEmitter: the .ptc to copy the emitter from (project or game). |
| `against` | string | no | diff: the .ptc to compare with. |
| `key` | string | no | catalog: filter by key text. |
| `confirm` | boolean | no | Write the change. Without it the call is a dry run. |
| `overwrite` | boolean | no | create: replace an existing file. |
| `allowUnknown` | boolean | no | Write a key or curve that is not in the catalog. |
| `cursor` | string | no | Reads: cursor from the last page. |
| `limit` | integer | no | Reads: rows per page. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/particle.<action>`. A row that links several actions is counted under each (35 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `addEmitter` | 2 | T2 1, T3 1 | `file:.ptc`, `mcp:action/particle.addEmitter` |
| `catalog` | 2 | T2 1, T5 1 | `file:.ptc`, `mcp:action/particle.catalog` |
| `cloneEmitter` | 2 | T2 1, T3 1 | `file:.ptc`, `mcp:action/particle.cloneEmitter` |
| `copyEmitter` | 2 | T2 1, T3 1 | `file:.ptc`, `mcp:action/particle.copyEmitter` |
| `create` | 2 | T2 1, T5 1 | `file:.ptc`, `mcp:action/particle.create` |
| `curves` | 2 | T2 1, T5 1 | `file:.ptc`, `mcp:action/particle.curves` |
| `diff` | 2 | T2 1, T5 1 | `file:.ptc`, `mcp:action/particle.diff` |
| `emitter` | 2 | T2 1, T5 1 | `file:.ptc`, `mcp:action/particle.emitter` |
| `emitters` | 3 | T1 1, T2 1, T5 1 | `file:.ptc`, `mcp:action/particle.emitters`, `ui:ParticleEditor/control/Effect Panel/Emitters` |
| `inspect` | 2 | T2 1, T5 1 | `file:.ptc`, `mcp:action/particle.inspect` |
| `moveEmitter` | 2 | T2 1, T3 1 | `file:.ptc`, `mcp:action/particle.moveEmitter` |
| `refs` | 2 | T2 1, T5 1 | `file:.ptc`, `mcp:action/particle.refs` |
| `removeEmitter` | 2 | T2 1, T3 1 | `file:.ptc`, `mcp:action/particle.removeEmitter` |
| `renameEmitter` | 2 | T2 1, T3 1 | `file:.ptc`, `mcp:action/particle.renameEmitter` |
| `set` | 2 | T2 1, T5 1 | `file:.ptc`, `mcp:action/particle.set` |
| `setCurve` | 2 | T2 1, T3 1 | `file:.ptc`, `mcp:action/particle.setCurve` |
| `validate` | 2 | T2 1, T5 1 | `file:.ptc`, `mcp:action/particle.validate` |
