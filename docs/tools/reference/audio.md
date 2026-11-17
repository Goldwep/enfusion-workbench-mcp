# audio

```text
Offline Audio Editor files: .acp sound projects, .sig signals, .afm mixers, audio-variable .conf; vanilla pak paths readable. Read: inspect, events, nodes, node, graph, samples, refs, variables, mixer, signal, validate, catalog. Write, project files only, dry run unless confirm: set, renameEvent, addSample, removeSample, setSample, setSimValue, addVariable, removeVariable, create.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/audio.md](../../../data/kb/census/tools/audio.md) |

## Actions (26)

`inspect`, `events`, `nodes`, `node`, `graph`, `samples`, `refs`, `variables`, `mixer`, `signal`, `validate`, `catalog`, `set`, `renameEvent`, `addSample`, `removeSample`, `setSample`, `setSimValue`, `addVariable`, `removeVariable`, `create`, `addNode`, `removeNode`, `connect`, `disconnect`, `group`

## Input parameters (31)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `inspect`, `events`, `nodes`, `node`, `graph`, `samples`, `refs`, `variables`, `mixer`, `signal`, `validate`, `catalog`, `set`, `renameEvent`, `addSample`, `removeSample`, `setSample`, `setSimValue`, `addVariable`, `removeVariable`, `create`, `addNode`, `removeNode`, `connect`, `disconnect`, `group`. |
| `path` | string | no | The file: project-relative, absolute in the project, or a game path. catalog: a folder prefix. |
| `projectPath` | string | no | Addon root. The configured project when omitted. |
| `confirm` | boolean | no | Write. Without it a write is a dry run (diff). |
| `overwrite` | boolean | no | create: replace an existing file. |
| `cursor` | string | no | Cursor from the last page. |
| `limit` | integer | no | Rows per page. |
| `node` | string \| integer | no | Node id or exact name. |
| `event` | any | no | Event name or id (a SoundClass). |
| `name` | string | no | Filter, new event name, sample or variable name. |
| `bank` | any | no | Bank id or name. |
| `sample` | any | no | Sample name or position in its bank. |
| `key` | string | no | set: property path inside the node, e.g. volume_dB. |
| `value` | string \| number \| boolean \| array<any> | no | set/setSimValue/addVariable: the value. |
| `quoted` | boolean | no | set: force quotes on or off. |
| `file` | string | no | Sample file: {GUID}path, or a registered project path. |
| `guid` | string | no | 16-hex GUID of file when it has no {GUID} prefix. |
| `index` | integer | no | Sample Index, or the input index of setSimValue. |
| `probability` | number | no | Sample Probability. |
| `port` | integer | no | setSimValue: input port of the signal. |
| `min` | number | no | setSimValue/addVariable: minimum. |
| `max` | number | no | setSimValue/addVariable: maximum. |
| `source` | string | no | addVariable: PlayTime, Amplitude, Constant, External. |
| `varOp` | string | no | addVariable: op, e.g. Max. |
| `section` | string | no | nodes: section filter. |
| `nodeClass` | string | no | nodes: class filter. |
| `direction` | string | no | graph: from a node. One of: `up`, `down`, `both`. |
| `depth` | integer | no | graph: hops from the node. |
| `kind` | string | no | refs: kind filter; catalog: acp, sig, afm, vars. |
| `acceptStale` | boolean | no | Write a .sig with a compiled block anyway. |
| `args` | object | no | Graph actions: arguments. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/audio.<action>`. A row that links several actions is counted under each (53 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `addNode` | 2 | T2 1, T3 1 | `file:.acp`, `mcp:action/audio.addNode` |
| `addSample` | 2 | T2 1, T3 1 | `file:.acp`, `mcp:action/audio.addSample` |
| `addVariable` | 2 | T2 1, T3 1 | `file:.acp`, `mcp:action/audio.addVariable` |
| `catalog` | 2 | T2 1, T5 1 | `file:.acp`, `mcp:action/audio.catalog` |
| `connect` | 2 | T2 1, T3 1 | `file:.acp`, `mcp:action/audio.connect` |
| `create` | 2 | T2 1, T5 1 | `file:.acp`, `mcp:action/audio.create` |
| `disconnect` | 2 | T2 1, T3 1 | `file:.acp`, `mcp:action/audio.disconnect` |
| `events` | 2 | T2 1, T5 1 | `file:.acp`, `mcp:action/audio.events` |
| `graph` | 2 | T2 1, T5 1 | `file:.acp`, `mcp:action/audio.graph` |
| `group` | 2 | T2 1, T3 1 | `file:.acp`, `mcp:action/audio.group` |
| `inspect` | 2 | T2 1, T5 1 | `file:.acp`, `mcp:action/audio.inspect` |
| `mixer` | 2 | T2 1, T5 1 | `file:.acp`, `mcp:action/audio.mixer` |
| `node` | 2 | T2 1, T5 1 | `file:.acp`, `mcp:action/audio.node` |
| `nodes` | 2 | T2 1, T5 1 | `file:.acp`, `mcp:action/audio.nodes` |
| `refs` | 2 | T2 1, T5 1 | `file:.acp`, `mcp:action/audio.refs` |
| `removeNode` | 2 | T2 1, T3 1 | `file:.acp`, `mcp:action/audio.removeNode` |
| `removeSample` | 2 | T2 1, T3 1 | `file:.acp`, `mcp:action/audio.removeSample` |
| `removeVariable` | 2 | T2 1, T3 1 | `file:.acp`, `mcp:action/audio.removeVariable` |
| `renameEvent` | 2 | T2 1, T3 1 | `file:.acp`, `mcp:action/audio.renameEvent` |
| `samples` | 2 | T2 1, T5 1 | `file:.acp`, `mcp:action/audio.samples` |
| `set` | 2 | T2 1, T3 1 | `file:.acp`, `mcp:action/audio.set` |
| `setSample` | 2 | T2 1, T3 1 | `file:.acp`, `mcp:action/audio.setSample` |
| `setSimValue` | 2 | T2 1, T3 1 | `file:.sig`, `mcp:action/audio.setSimValue` |
| `signal` | 2 | T2 1, T5 1 | `file:.sig`, `mcp:action/audio.signal` |
| `validate` | 3 | T2 2, T5 1 | `file:.acp`, `file:.sig`, `mcp:action/audio.validate` |
| `variables` | 2 | T2 1, T5 1 | `file:.acp`, `mcp:action/audio.variables` |
