# animation_graph

```text
Animation graph files (.agf .agr .ast .asi .aw), offline, lossless. inspect (format json pages it), validate (rules that fire on vanilla are warnings), nodes (Animation Editor class catalog), edit: .agf addNode removeNode setProp connect disconnect addSheet removeSheet; .agr addFile removeFile setDefaultRunNode addVariable removeVariable; project files, dry run unless confirm. author, setup.
```

| Field | Value |
| --- | --- |
| Tier | extended |
| Registered under ENFUSION_TOOLSET | extended, all |
| Census KB page | [data/kb/census/tools/animation_graph.md](../../../data/kb/census/tools/animation_graph.md) |

## Actions (6)

`author`, `inspect`, `setup`, `validate`, `nodes`, `edit`

## Input parameters (47)

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `action` | string | yes | One of: `author`, `inspect`, `setup`, `validate`, `nodes`, `edit`. |
| `vehicleName` | string | no | (author/setup) Vehicle name, used in file names and GlobalTags. |
| `vehicleType` | string | no | (author/setup) Vehicle type. One of: `wheeled`, `tracked`, `helicopter`, `boat`. Default: `"wheeled"`. |
| `wheelCount` | integer | no | (author/setup) Wheels (2/4/6/8). Default: `4`. |
| `hasTurret` | boolean | no | (author/setup) Turret variables and bone mask. Default: `false`. |
| `hasSuspensionIK` | boolean | no | (author/setup) Suspension IK chains. Default: `true`. |
| `hasShockAbsorbers` | boolean | no | (author/setup) Shock absorber IK chains. Default: `false`. |
| `hasSteeringLinkage` | boolean | no | (author/setup) Steering axis IK chains. Default: `false`. |
| `seatTypes` | array<string> | no | (author/setup) Seat types. Default: `["driver"]`. |
| `dialList` | array<string> | no | (author/setup) Variables used as dials. Default: `[]`. |
| `outputPath` | string | no | (author/setup) Destination folder in the project. |
| `modName` | string | no | (author/setup) Addon folder name. |
| `projectPath` | string | no | Project root. Uses the configured project when omitted. |
| `path` | string | no | The file (.agr .agf .ast .asi .aw), project-relative (source mod) or game-relative (source game). |
| `inspectAction` | string | no | (inspect) validate = the validate action, 1.x text report. One of: `inspect`, `validate`. Default: `"inspect"`. |
| `source` | string | no | Read from the project (mod) or the game data (game). One of: `mod`, `game`. Default: `"mod"`. |
| `agrPath` | string | no | (validate, setup suggest) The .agr for cross-checks. |
| `asiPath` | string | no | (validate) The .asi for mapping checks. |
| `format` | string | no | (inspect) json: paged items instead of the text summary. One of: `text`, `json`. |
| `cursor` | string | no | (inspect json, validate, nodes) <start>:<count> from nextCursor. |
| `limit` | integer | no | Page size (default 100). |
| `step` | string | no | (setup) Section to return. One of: `all`, `agr`, `agf_instructions`, `prefab_setup`, `checklist`. Default: `"all"`. |
| `agfPath` | string | no | (setup suggest) The .agf to analyse. |
| `preset` | string | no | (setup guide) Preset. One of: `character`, `weapon`, `prop`, `custom`. |
| `setupSubAction` | string | no | (setup) Sub-action. One of: `setup`, `suggest`, `guide`. Default: `"setup"`. |
| `query` | string | no | (nodes) Substring of the class (or enum key) name. |
| `kind` | string | no | (nodes) Class kind; enum lists the enum-like keys with their values. One of: `node`, `item`, `event`, `graph`, `file`, `legacy`, `other`, `enum`. |
| `nodeClass` | string | no | (nodes) One class with its keys. (edit addNode) The class. |
| `op` | string | no | (edit) The op. One of: `addNode`, `removeNode`, `setProp`, `connect`, `disconnect`, `addSheet`, `removeSheet`, `addFile`, `removeFile`, `setDefaultRunNode`, `addVariable`, `removeVariable`. |
| `sheet` | string | no | (edit .agf) The sheet; optional when unambiguous. |
| `name` | string \| null | no | (edit) Node, sheet or variable name; setDefaultRunNode: the node (null removes). |
| `node` | string | no | (edit setProp/connect/disconnect) The node. |
| `prop` | string | no | (edit setProp) Path in the node: Child, BlendWeight, QueueItems[0].Child. |
| `value` | string \| number \| boolean \| array<any> \| null | no | (edit setProp) The value; a list writes several; null removes. |
| `quoted` | boolean | no | (edit setProp/connect) Force quotes on or off. |
| `to` | string | no | (edit connect) The child node. |
| `slot` | string | no | (edit connect/disconnect) Slot path (default Child). |
| `file` | string | no | (edit addFile/removeFile) {GUID}path.agf. |
| `varType` | string | no | (edit addVariable) Float (default), Int, Bool, String. One of: `Float`, `Int`, `Bool`, `String`. |
| `min` | number \| string | no | (edit addVariable) MinValue. |
| `max` | number \| string | no | (edit addVariable) MaxValue. |
| `defaultValue` | number \| string | no | (edit addVariable) DefaultValue. |
| `props` | object | no | (edit addNode) {key: value} of the new node. |
| `editorPos` | array<any> | no | (edit addNode) EditorPos x y. |
| `raw` | string | no | (edit) Exact lines to restore, as readback.inverse gives them. |
| `index` | integer | no | (edit) Position in the block (default end). |
| `confirm` | boolean | no | (edit) true writes; otherwise a dry run. |

## Linked census rows

Ledger rows whose `mcp` links name `mcp:action/animation_graph.<action>`. A row that links several actions is counted under each (30 links in all).

| Action | Rows | By tier | First ids |
| --- | --- | --- | --- |
| `author` | 7 | T2 6, T3 1 | `file:.agf`, `file:.agr`, `file:.anm` |
| `edit` | 3 | T2 2, T3 1 | `file:.agf`, `file:.agr`, `mcp:action/animation_graph.edit` |
| `inspect` | 7 | T2 6, T3 1 | `file:.agf`, `file:.agr`, `file:.anm` |
| `nodes` | 3 | T2 2, T5 1 | `file:.agf`, `file:.agr`, `mcp:action/animation_graph.nodes` |
| `setup` | 7 | T2 6, T3 1 | `file:.agf`, `file:.agr`, `file:.anm` |
| `validate` | 3 | T2 2, T5 1 | `file:.agf`, `file:.agr`, `mcp:action/animation_graph.validate` |
